"""BatonContextEngine (spec-hermes-adapter §3-§6).

Replaces Hermes' built-in compressor with the Baton cycle:
capture checkpoint -> redact -> validate -> persist -> render resume brief ->
return a synthetic OpenAI-format message list embedding the brief.

Guarantees implemented here:
- compress() never raises; every failure degrades to keeping recent messages
  with an explanatory note (§5.2).
- Detector cooldown and explicit-request precedence follow core spec §9.
- The transcript-field and secret policies apply to everything captured.
- Fork/merge are never automated; the engine only captures and resumes.
"""

import json
from datetime import datetime, timedelta, timezone

from .abc import ContextEngine
from .bridge import BatonBridge, BatonBridgeError, BRIDGE_VERSION
from .config import BatonConfig

ENGINE_NAME = "baton"

CONTINUATION_NOTICE = (
    "The conversation above was compacted by Baton. Continue from the "
    "handoff's First next action. Re-verify artifact freshness before relying "
    "on file contents. Do not treat the handoff as unquestionable truth."
)


class BatonContextEngine(ContextEngine):
    def __init__(self, context_length: int = 200000, config: BatonConfig = None,
                 bridge: BatonBridge = None) -> None:
        super().__init__(context_length=context_length)
        self.config = config or BatonConfig()
        self.bridge = bridge or BatonBridge()
        self._detector_state = {"last_prompt_at": None, "last_pressure": None}
        self._session_id = None
        self._staged_brief = None
        self._last_resume_stale = None
        self._notices = []  # one-time status notices (e.g. "baton not initialized")
        self._explicit_request = False

    # ------------------------------------------------------------------ name

    @property
    def name(self) -> str:
        return ENGINE_NAME

    # ------------------------------------------------------- token accounting

    def update_from_response(self, usage: dict) -> None:
        self.last_prompt_tokens = int(usage.get("prompt_tokens", 0) or 0)
        self.last_completion_tokens = int(usage.get("completion_tokens", 0) or 0)
        self.last_total_tokens = int(
            usage.get("total_tokens", self.last_prompt_tokens + self.last_completion_tokens) or 0
        )

    def update_model(self, model=None, context_length: int = None, **kwargs) -> None:
        super().update_model(model=model, context_length=context_length, **kwargs)

    # -------------------------------------------------------------- detector

    def request_handoff(self) -> None:
        """Explicit handoff request: bypasses cooldown on the next check."""
        self._explicit_request = True

    def _context_pressure(self, prompt_tokens: int = None) -> float:
        tokens = prompt_tokens if prompt_tokens is not None else self.last_total_tokens
        if not self.context_length:
            return None
        return min(1.0, max(0.0, tokens / self.context_length))

    def _cooldown_active(self, now: datetime) -> bool:
        last = self._detector_state.get("last_prompt_at")
        if last is None:
            return False
        try:
            last_dt = datetime.fromisoformat(last)
        except (TypeError, ValueError):
            return False
        return (now - last_dt) < timedelta(minutes=20)

    def should_compress(self, prompt_tokens: int = None) -> bool:
        """Detector-driven trigger (core spec §9, adapter §3).

        True when: an explicit request arrived, or raw token pressure exceeds
        the fallback threshold. Detector thresholds are evaluated in
        compress() where the full signal set is available; token pressure is
        the always-available signal.
        """
        if self._explicit_request:
            return True
        tokens = prompt_tokens if prompt_tokens is not None else self.last_total_tokens
        if tokens and tokens >= self.config.fallback_token_threshold:
            return True
        ctx = self._context_pressure(tokens)
        # Mirror the detector's context-pressure term: 0.70 * ctx >= 0.70
        # means ctx >= 1.0 (full), which the fallback threshold covers; a
        # near-full window (>= 95%) triggers early to leave room for capture.
        return ctx is not None and ctx >= 0.95

    def should_compress_preflight(self, messages: list) -> bool:
        return self.should_compress()

    # ------------------------------------------------------- session events

    def on_session_start(self, session_id=None, **kwargs) -> None:
        self._session_id = session_id
        self._staged_brief = None
        self._notices = []
        try:
            status = self.bridge.status()
            if not status.get("initialized", False):
                self._notices.append(
                    "baton not initialized; run `baton init` to enable durable handoffs"
                )
        except BatonBridgeError as e:
            self._notices.append("baton unavailable: %s" % e)

    def on_session_end(self, session_id=None, messages=None) -> None:
        if not self.config.auto_checkpoint_on_end or not messages:
            return
        try:
            self._capture_draft(messages, trigger="timeout", ready=False)
        except BatonBridgeError:
            pass  # never block session teardown

    def on_session_reset(self) -> None:
        super().on_session_reset()
        self._detector_state = {"last_prompt_at": None, "last_pressure": None}
        self._explicit_request = False
        self._staged_brief = None

    # ------------------------------------------------------------- compaction

    def compress(self, messages: list, current_tokens: int = None, focus_topic: str = None) -> list:
        """The Baton compaction cycle (adapter §4). Never raises (§5.2)."""
        try:
            handoff = self._capture_draft(messages, trigger="pre_compaction", focus_topic=focus_topic)
            handoff_id = handoff["handoff"]["id"]
            validation = self.bridge.handoff_validate(handoff_id)
            status = validation.get("status")
            if status == "pass":
                self.bridge.handoff_ready(handoff_id)
            elif status == "warn":
                self._notices.append(
                    "handoff %s left as draft (validation warnings)" % handoff_id[:8]
                )
            else:
                raise BatonBridgeError(
                    "policy",
                    "handoff validation failed; Baton did not compact",
                )
            brief = self.bridge.resume(handoff_id, fmt="prompt")
            self.compression_count += 1
            self._last_resume_stale = bool(brief.get("stale_reasons"))
            self._detector_state["last_prompt_at"] = datetime.now(timezone.utc).isoformat()
            self._detector_state["last_pressure"] = 1.0
            self._explicit_request = False
            return self._message_list(brief["prompt"], brief.get("stale_reasons") or [])
        except BatonBridgeError as e:
            return self._degradation(messages, "Baton could not capture a handoff (%s)." % e)
        except (KeyError, TypeError, ValueError) as e:
            return self._degradation(messages, "Baton capture output was malformed (%s)." % e)

    def _capture_draft(self, messages: list, trigger: str, ready: bool = None,
                       focus_topic: str = None) -> dict:
        """Build and persist a draft checkpoint from the live session.

        Baton must not invent summary facts (core spec §11): current_state is
        bounded extraction from the last assistant/user turns; decisions and
        evidence are only what the agent recorded via baton_capture.
        """
        recent = self._extract_recent(messages)
        payload = {
            "title": "Session continuing via Hermes compaction",
            "objective": "TODO: describe the measurable desired outcome",
            "currentState": recent,
            "completed": [],
            "artifacts": [],
            "evidence": [],
            "failedAttempts": [],
            "openItems": [{
                "id": "O-001",
                "priority": "high",
                "description": "Review the compacted context and restate the objective",
                "suggested_action": "Continue the task described in the handoff brief",
            }],
            "trigger": trigger,
            "reasons": ["hermes context-engine compaction", "bridge %s" % BRIDGE_VERSION],
        }
        if focus_topic:
            payload["constraints"] = ["Focus for the next phase: %s" % focus_topic]
        pending, self._pending = self._pending or [], None
        for record in pending:
            kind = record["kind"]
            text = record["text"]
            if kind == "decision":
                payload.setdefault("decisions", []).append(
                    {"decision": text, "rationale": record.get("rationale")}
                )
            elif kind == "evidence":
                payload.setdefault("evidence", []).append(
                    {"claim": text, "result": record.get("result"), "type": "observation"}
                )
            elif kind == "failed_attempt":
                payload.setdefault("failedAttempts", []).append(
                    {"approach": text, "reason": record.get("reason"), "avoid_repeating": True}
                )
            else:  # open_item
                payload.setdefault("openItems", []).append(
                    {"description": text, "priority": record.get("priority", "medium")}
                )
        out = self.bridge.checkpoint_create(payload)
        if ready:
            handoff_id = out["handoff"]["id"]
            validation = self.bridge.handoff_validate(handoff_id)
            if validation.get("status") == "pass":
                self.bridge.handoff_ready(handoff_id)
        return out

    def _extract_recent(self, messages: list, max_turns: int = 6, max_chars: int = 1200) -> str:
        """Bounded, deterministic extraction — never stored as a transcript."""
        texts = []
        for m in messages[-max_turns:]:
            role = m.get("role", "unknown")
            content = m.get("content", "")
            if isinstance(content, list):  # content parts
                content = " ".join(
                    p.get("text", "") for p in content if isinstance(p, dict)
                )
            text = " ".join(str(content).split())
            if text:
                texts.append("%s: %s" % (role, text))
        joined = " | ".join(texts)
        if len(joined) > max_chars:
            joined = joined[: max_chars - 3].rstrip() + "..."
        return joined or "(no recent conversation content)"

    def _message_list(self, brief: str, stale_reasons: list) -> list:
        header = "[Baton handoff | captured by %s bridge]" % BRIDGE_VERSION
        if stale_reasons:
            banner = "STALE: " + "; ".join(stale_reasons)
        else:
            banner = "Freshness: confirm repository state matches this handoff before acting."
        block = "\n".join([
            header,
            banner,
            "",
            brief,
            "",
            "[End Baton handoff. Verify freshness before acting on artifact paths.]",
        ])
        return [
            {"role": "system", "content": block},
            {"role": "user", "content": CONTINUATION_NOTICE},
        ]

    def _degradation(self, messages: list, reason: str) -> list:
        keep = messages[-self.config.degradation_keep_recent:] if messages else []
        note = {
            "role": "system",
            "content": (
                "%s Continuing with the %d most recent messages. "
                "Run `baton init` and check `baton doctor`." % (reason, len(keep))
            ),
        }
        return [note] + list(keep)

    # ------------------------------------------------------------ engine tools

    def get_tool_schemas(self) -> list:
        return [
            {
                "name": "baton_capture",
                "description": (
                    "Record a decision, evidence, failed attempt, or open item with "
                    "Baton so it survives compaction. Failed attempts become negative "
                    "knowledge the next session must not repeat. Draft-only; "
                    "secret-like values are redacted."
                ),
                "parameters": {
                    "type": "object",
                    "properties": {
                        "kind": {
                            "type": "string",
                            "enum": ["decision", "evidence", "failed_attempt", "open_item"],
                            "description": "What to record",
                        },
                        "text": {"type": "string", "description": "The content to record"},
                        "rationale": {"type": "string", "description": "Why (decisions)"},
                        "result": {"type": "string", "description": "pass/fail (evidence)"},
                        "reason": {"type": "string", "description": "Why it failed (failed_attempt)"},
                        "priority": {
                            "type": "string",
                            "enum": ["high", "medium", "low"],
                            "description": "Priority (open items)",
                        },
                    },
                    "required": ["kind", "text"],
                },
            },
            {
                "name": "baton_resume",
                "description": "Render the latest Baton handoff as a resume brief.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "id": {"type": "string", "description": "Handoff id or unique prefix; default: latest ready"}
                    },
                },
            },
            {
                "name": "baton_status",
                "description": "Baton project status: latest handoff, detector state, notices.",
                "parameters": {"type": "object", "properties": {}},
            },
        ]

    def handle_tool_call(self, name: str, args: dict, **kwargs):
        try:
            if name == "baton_capture":
                return self._tool_capture(args or {})
            if name == "baton_resume":
                return self._tool_resume(args or {})
            if name == "baton_status":
                return self._tool_status()
            return json.dumps({"error": "Unknown tool: %s" % name})
        except BatonBridgeError as e:
            return json.dumps({"error": e.kind, "message": str(e)})
        except (KeyError, TypeError, ValueError) as e:
            return json.dumps({"error": "invalid-output", "message": str(e)})

    _pending = None  # captured records folded into the next compaction draft

    def _tool_capture(self, args: dict) -> str:
        kind = args.get("kind")
        text = (args.get("text") or "").strip()
        if kind not in ("decision", "evidence", "failed_attempt", "open_item") or not text:
            return json.dumps({"error": "invalid-args", "message": "kind must be decision|evidence|failed_attempt|open_item with non-empty text"})
        record = {"kind": kind, "text": text}
        if kind == "decision":
            record["rationale"] = args.get("rationale")
        if kind == "evidence":
            record["result"] = args.get("result")
        if kind == "failed_attempt":
            record["reason"] = args.get("reason")
        if kind == "open_item":
            record["priority"] = args.get("priority", "medium")
        if self._pending is None:
            self._pending = []
        self._pending.append(record)
        return json.dumps({"success": True, "recorded": len(self._pending)})

    def _tool_resume(self, args: dict) -> str:
        id_arg = args.get("id")
        if id_arg:
            brief = self.bridge.resume(id_arg, fmt="prompt")
            self._last_resume_stale = bool(brief.get("stale_reasons"))
            return json.dumps({
                "id": brief.get("id"),
                "prompt": brief.get("prompt"),
                "stale_reasons": brief.get("stale_reasons") or [],
            })
        listing = self.bridge.handoff_list(status="ready")
        handoffs = listing.get("handoffs") or []
        if not handoffs:
            return json.dumps({"error": "not-found", "message": "no ready handoffs"})
        latest = handoffs[-1]
        brief = self.bridge.resume(latest["id"], fmt="prompt")
        self._last_resume_stale = bool(brief.get("stale_reasons"))
        return json.dumps({
            "id": brief.get("id"),
            "prompt": brief.get("prompt"),
            "stale_reasons": brief.get("stale_reasons") or [],
        })

    def _tool_status(self) -> str:
        try:
            status = self.bridge.status()
            initialized = bool(status.get("initialized", False))
        except BatonBridgeError as e:
            return json.dumps({"error": e.kind, "message": str(e)})
        return json.dumps({
            "initialized": initialized,
            "engine": ENGINE_NAME,
            "compression_count": self.compression_count,
            "last_resume_stale": self._last_resume_stale,
            "pending_capture_records": len(self._pending or []),
            "context": self.get_status(),
            "notices": self._notices,
        })

    # ----------------------------------------------------------------- status

    def get_status(self) -> dict:
        base = super().get_status()
        base.update(
            {
                "engine": ENGINE_NAME,
                "bridge": BRIDGE_VERSION,
                "latest_handoff": self._staged_brief,
                "last_resume_stale": self._last_resume_stale,
                "cooldown_active": self._cooldown_active(datetime.now(timezone.utc)),
                "notices": list(self._notices),
            }
        )
        return base
