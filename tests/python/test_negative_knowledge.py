"""Negative-knowledge tests (improvement plan §6).

The Hermes engine's ``baton_capture`` tool must accept ``failed_attempt``
records and fold them into the next compaction draft, so failed approaches
survive the handoff boundary as negative knowledge.
"""

import json

from baton import BatonBridge, BatonContextEngine, BatonConfig


class TestFailedAttemptCapture:
    def test_failed_attempt_kind_is_accepted(self, engine):
        out = json.loads(
            engine.handle_tool_call(
                "baton_capture",
                {"kind": "failed_attempt", "text": "Use library X", "reason": "No multi-tenant support"},
            )
        )
        assert out["success"] is True
        assert out["recorded"] == 1

    def test_capture_tool_schema_lists_failed_attempt(self, engine):
        schemas = engine.get_tool_schemas()
        capture = next(s for s in schemas if s["name"] == "baton_capture")
        assert "failed_attempt" in capture["parameters"]["properties"]["kind"]["enum"]

    def test_unknown_kind_still_rejected(self, engine):
        out = json.loads(engine.handle_tool_call("baton_capture", {"kind": "nope", "text": "x"}))
        assert out["error"] == "invalid-args"


class TestFailedAttemptParity:
    def test_capture_folds_failed_attempts_into_draft(self, real_project):
        root, cli = real_project["root"], real_project["cli"]
        bridge = BatonBridge(cli_path=cli, project_root=root)
        bridge.init()
        engine = BatonContextEngine(context_length=200000, config=BatonConfig(), bridge=bridge)
        engine.on_session_start("s1")
        r1 = json.loads(
            engine.handle_tool_call(
                "baton_capture",
                {"kind": "failed_attempt", "text": "Use library X", "reason": "No multi-tenant support"},
            )
        )
        assert r1["success"] is True
        r2 = json.loads(
            engine.handle_tool_call(
                "baton_capture",
                {"kind": "decision", "text": "Build in-house instead", "rationale": "X failed the requirement"},
            )
        )
        assert r2["success"] is True

        msgs = [{"role": "user", "content": "work %d" % i} for i in range(4)]
        engine.compress(msgs)

        # The draft on disk carries the failed approach as negative knowledge.
        handoff_files = [f for f in __import__("os").listdir(__import__("os").path.join(root, ".baton", "handoffs")) if f.endswith(".json")]
        assert len(handoff_files) == 1
        on_disk = json.load(open(__import__("os").path.join(root, ".baton", "handoffs", handoff_files[0])))
        assert len(on_disk["failed_attempts"]) == 1
        fa = on_disk["failed_attempts"][0]
        assert fa["approach"] == "Use library X"
        assert fa["reason"] == "No multi-tenant support"
        assert fa["avoid_repeating"] is True
        assert any(d["decision"] == "Build in-house instead" for d in on_disk["decisions"])

    def test_resume_brief_contains_do_not_retry(self, real_project):
        root, cli = real_project["root"], real_project["cli"]
        bridge = BatonBridge(cli_path=cli, project_root=root)
        bridge.init()
        created = bridge.checkpoint_create(
            {
                "title": "Negative knowledge parity",
                "objective": "Failed approaches render in the brief.",
                "currentState": "one approach abandoned",
                "failedAttempts": [
                    {
                        "id": "F-001",
                        "approach": "Use library X",
                        "outcome": "failed",
                        "reason": "Does not support multi-tenant configuration",
                        "avoid_repeating": True,
                    }
                ],
                "openItems": [
                    {"id": "O-001", "priority": "high", "description": "Next", "suggested_action": "Act"}
                ],
            }
        )
        hid = created["handoff"]["id"]
        bridge.handoff_validate(hid)
        bridge.handoff_ready(hid)
        brief = bridge.resume(hid)
        assert "## Do not retry" in brief["prompt"]
        assert "Use library X" in brief["prompt"]
