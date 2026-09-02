# Baton — Hermes Agent Context-Engine Adapter

**Replace Hermes' built-in context compressor with Baton handoff compaction.**

**Status:** implementation specification / adapter v0.1
**Product name:** `Baton` (this repository's working name is `baton`; the rename is scoped in §7)
**Companion spec:** [`spec.md`](./spec.md) — the canonical handoff schema, local-first policy, and detector model are invariant here.

**Hermes references:**
- Plugin system: <https://github.com/dqfront/NousResearch-hermes-agent/blob/main/website/docs/user-guide/features/plugins.md>
- Context-engine plugin guide: <https://github.com/dqfront/NousResearch-hermes-agent/blob/main/website/docs/developer-guide/context-engine-plugin.md>

---

## 1. Purpose

Hermes ships a built-in context compressor (`ContextCompressor`, selected as
`context.engine: "compressor"`). It compacts conversation history with lossy
summarization when token pressure rises. That is exactly the behavior Baton is
built to replace:

| Built-in compressor | Baton as Hermes context engine |
|---|---|
| Opaque summarization of the past | Explicit, validated handoff records on disk |
| Durable knowledge mixed with narration | State, not story: decisions, evidence, open items |
| Compaction = information loss | Compaction = versioned, inspectable handoff |
| No artifact continuity | Artifact paths + content hashes carried forward |
| No audit trail of what was dropped | `redactions`/`validation.checks` audit everything |

Baton becomes **Hermes' first real adapter**: when the Hermes engine is
active, a compaction event stops being an invisible summarization and becomes
a Baton checkpoint → validate → handoff cycle, with a compact resume brief
hydrated back into the conversation. The user keeps the audit trail in
`.baton/handoffs/` (directory rename in §7) and can resume the same work
in any other harness later.

## 2. How Hermes selects engines (contract summary)

From the Hermes docs (normative for this adapter):

- Context engines live in `plugins/context_engine/<name>/` with a
  `plugin.yaml` and an `__init__.py` that exports a `ContextEngine` subclass.
- Engines are **single-select providers**: all discovered engines are loaded,
  but exactly one is active, chosen by config:

  ```yaml
  context:
    engine: baton   # must match the engine's `name` property
  ```

- Plugin engines are **never auto-activated**; the user must explicitly set
  `context.engine: baton` (or pick it in `hermes plugins` → Provider Plugins
  → Context Engine).
- The `compression.*` config block belongs to the built-in compressor. Baton
  defines its **own** config format (§4) read from `config.yaml` during
  initialization.
- A general plugin may alternatively call
  `ctx.register_context_engine(engine)`; only one registration wins.

## 3. The `ContextEngine` interface, implemented by Baton

Hermes' ABC (`agent/context_engine.ContextEngine`) requires:

| Member | Baton implementation |
|---|---|
| `name` property | `"baton"` |
| `update_from_response(usage)` | Track `last_prompt_tokens` / `last_completion_tokens` / `last_total_tokens`; also accumulate rolling turn/elapsed pressure for the detector. |
| `should_compress(prompt_tokens)` | `True` when the **detector** (spec §9) says so: pressure ≥ `recommendThreshold` with readiness ≥ `autoPrepareThreshold`, **or** an explicit request arrived, **or** raw token pressure exceeds `fallback_token_threshold` (see §5.2). |
| `compress(messages, current_tokens, focus_topic)` | The Baton cycle (§4): capture checkpoint → validate → mark ready → render resume brief → return a synthetic message list that embeds the brief. |
| `last_*`, `threshold_tokens`, `context_length`, `compression_count` | Maintained as the ABC documents; `compression_count` increments per Baton handoff. |

Optional methods Baton overrides:

| Method | Baton behavior |
|---|---|
| `on_session_start(session_id)` | Load most recent `ready` handoff for the project (if any) and stage its resume brief; initialize the detector state (cooldown window, last pressure). |
| `on_session_end(session_id, messages)` | If the detector recommends and `auto_checkpoint_on_end` is set, capture a final checkpoint (draft; never auto-ready). Flush detector state. |
| `on_session_reset()` | Clear per-session detector state; canonical handoffs are untouched (they are durable artifacts, not session state). |
| `update_model(model, context_length, ...)` | Recompute `threshold_tokens` and normalize `context_pressure = tokens / context_length` for the detector. |
| `get_tool_schemas()` / `handle_tool_call(name, args)` | Expose Baton tools to the agent (§6): `baton_capture`, `baton_resume`, `baton_status`. |
| `get_status()` | Standard token dict **plus** Baton fields: latest handoff id/status, detector pressure/readiness/reasons, cooldown remaining, staleness of the last resume. |

## 4. The Baton compaction cycle

When Hermes calls `compress(messages, current_tokens, focus_topic)`:

1. **Capture (checkpoint).** Build a draft handoff from the live session:
   - `work.title` / `work.objective`: from the active objective if tracked
     this session; otherwise synthesized as `"Session continuing via Hermes
     compaction"` with `TODO` objective markers — Baton **must not invent**
     summary facts (spec §11).
   - `summary.current_state`: rendered from the last N assistant messages
     (bounded, deterministic extraction; no transcript storage).
   - `decisions` / `evidence`: only what the agent explicitly recorded this
     session via `baton_capture` (§6) or that appears in engine-provided tool
     results. Never synthesized.
   - `artifacts`: files the session touched, with git revision and content
     hash when available.
   - `origin`: `{ harness: "generic", adapter_version: "hermes-0.1.0",
     session_id: <opaque hashed>, model: <model id> }`.
   - `automation`: `{ trigger: "pre_compaction", score, reasons }` — the
     detector's auditable recommendation.
2. **Redact & validate.** Run the standard redaction pipeline and the
   deterministic validator (spec §10). The transcript-field policy and secret
   policy apply unchanged.
3. **Persist.** Draft is written atomically. If validation is `pass`, the
   engine marks it `ready` (it is an automated capture with the user's
   standing consent to compact); if `warn`, it stays `draft` and the warning
   is surfaced in `get_status()` and the injected notice. `fail` never
   silently compacts: the engine returns a minimal failure notice instead
   (§5.3).
4. **Render.** Generate the resume brief (`renderResumePrompt`, ≤1,200
   tokens) plus the stale check against current git state.
5. **Return the new message list** (§5): a valid OpenAI-format sequence whose
   content is Baton state, not a paraphrase of the conversation.

`focus_topic` from manual `/compress <focus>` is stored on the draft as a
constraint line ("Focus for the next phase: …") so guided compaction survives
the handoff.

## 5. Message-list construction

### 5.1 Shape

`compress()` returns:

```text
[
  { role: "system",  content: < Baton working-context block §5.2 > },
  { role: "user",    content: < continuation notice §5.3 > }
]
```

The working-context block embeds the resume brief verbatim inside a fenced
section, prefixed with provenance:

```text
[Baton handoff <short-id> | status: ready | captured <ts>]
<resume brief>
[End Baton handoff. Verify freshness before acting on artifact paths.]
```

### 5.2 Sizing rules

- Brief target ≤1,200 tokens (existing renderer budget). The system block
  adds a fixed header + freshness banner: ≤1,400 tokens total in the normal
  case.
- If the record is stale (git head moved or artifacts drifted), the banner
  becomes the prominent STALE section per spec §10/§22.3 — Baton never
  silently applies stale assumptions.
- If the handoff cannot be produced (validation `fail`, no project root, no
  disk write), Baton degrades gracefully: it returns the last
  `degradation_keep_recent` messages verbatim (bounded by
  `degradation_max_tokens`) plus a system note explaining that Baton could
  not capture a handoff. It never throws out of `compress()` — a context
  engine must always return a usable list.

### 5.3 Continuation notice

The user-role message is a fixed, minimal instruction:

> The conversation above was compacted by Baton. Continue from the handoff's
> First next action. Re-verify artifact freshness before relying on file
> contents. Do not treat the handoff as unquestionable truth.

## 6. Engine tools exposed to the agent

Returned from `get_tool_schemas()`, dispatched via `handle_tool_call`:

| Tool | Purpose | Guardrails |
|---|---|---|
| `baton_capture` | Agent records decisions/evidence/failed attempts/open items mid-session; feeds the next compaction's draft. Failed attempts become negative knowledge rendered as "Do not retry" in the resume brief. | Draft-only; redaction pipeline applies; ids `D-*/E-*/F-*/O-*` auto-assigned or validated. |
| `baton_resume` | Render the current/latest handoff brief on demand. | No file writes except the optional session marker. |
| `baton_status` | Latest handoff, detector pressure/readiness/reasons, cooldown, staleness. | Read-only. |

These are thin wrappers over `@baton/core` (renamed `@baton/core`, §7)
via the CLI or in-process library calls; semantics, JSON contracts, and exit
behavior stay identical to the CLI (spec §11). The engine **must not** expose
any generic shell tool.

## 7. Rename scope (baton → Baton)

The product ships as **Baton**. Mechanical rename, no schema/policy changes:

1. npm scope/package names: `@baton/*` → `@baton/*`; bin `baton` →
   `baton` (keep a `baton` alias for one minor release).
2. Storage directory: legacy `.threadline/` → `.baton/` (config, handoffs,
   cache, index). **Discovery + migration:** commands resolve the storage
   directory by preferring `.baton/` and falling back to a legacy
   `.threadline/` when it exists; `baton init --migrate-legacy` and
   `baton migrate [--dry-run]` perform the move + `$schema`-preserving
   rewrite **only with explicit user consent** — never automatically.
   Canonical records themselves change only in `$schema` (both ids accepted
   for v0.1).
3. Schema `$id`: legacy `https://threadline.dev/schemas/handoff/v0.1.json` →
   `https://baton.dev/schemas/handoff/v0.1.json`. Readers accept both ids
   during the transition (forward-compat rule already requires accepting
   unknown/extra fields).
4. Detector config block: `detector` stays `detector` in config; user-facing
   strings, docs, and the skill text say Baton.
5. MCP server name: `threadline-mcp` → `baton-mcp`; tool names gain a `baton_`
   prefix or keep `handoff_*` names — decision: **keep `handoff_*` names**
   (they are already vendor-neutral and match the spec's MCP table), change
   only the server name.
6. This repository: rename in README/docs/skills; `SPEC.md` remains the
   product spec with the title updated to Baton.

## 8. Plugin packaging and installation

```text
plugins/context_engine/baton/
├── plugin.yaml          # name: baton, version, description
├── __init__.py          # exports BatonContextEngine(ContextEngine)
├── engine.py            # the ContextEngine implementation
├── bridge.py            # subprocess bridge to the Baton CLI (JSON only)
├── config.py            # baton.* config block parsing + defaults
├── baton_tool_schemas.py
└── data/
    └── SKILL.md         # bundled skill: registered via ctx.register_skill
```

The Python side is a **bridge, not a port**: it shells out to the Baton CLI
(`baton --json …`) so there is exactly one implementation of the schema,
validation, redaction, and rendering. The bridge:

- Locates the CLI (`BATON_CLI` env var → `baton` on PATH → error with install
  hint).
- Locates the project root (Hermes cwd; walks up to the nearest `.baton/`).
- Calls only documented commands with `--json`; parses stable contracts.
- Fails soft: every failure mode maps to the degradation path (§5.2), with
  the reason in `get_status()`.

Install path (user):

```bash
# one-time: build & install the Baton CLI
cd baton && pnpm install && pnpm build && npm i -g ./packages/cli

# install the engine into Hermes
cp -r plugins/context_engine/baton ~/.hermes/plugins/context_engine/baton

# select it
hermes config set context.engine baton   # or edit ~/.hermes/config.yaml
```

Config surface (read by `config.py`, all optional):

```yaml
context:
  engine: baton
baton:
  cli_path: /usr/local/bin/baton      # override discovery
  auto_checkpoint_on_end: true        # draft checkpoint at session end
  fallback_token_threshold: 160000    # hard trigger independent of signals
  degradation_keep_recent: 12         # messages kept if Baton cannot capture
  degradation_max_tokens: 4000
  brief_max_tokens: 1200              # renderer budget
```

## 9. Behavioral guarantees (acceptance)

1. With `context.engine: baton`, the built-in compressor never runs; every
   compaction event produces (a) a canonical handoff file on disk and (b) a
   synthetic message list embedding its resume brief.
2. The handoff file validates against `handoff-v0.1.json`, contains no
   transcript fields, and its `automation` block shows trigger
   `pre_compaction` with the detector's inputs/reasons.
3. If the project is not Baton-initialized, the engine still compacts via the
   degradation path but logs "baton not initialized" in `get_status()` and
   emits a one-time notice advising `baton init`.
4. A stale handoff renders the STALE banner in the injected block (spec
   §22.3).
5. Secret-like content in the captured state is redacted before write, with
   `redactions` recorded; raw values never reach disk (§22.4).
6. Detector cooldown is honored: repeated compaction pressure does not spam
   handoffs; explicit requests bypass cooldown.
7. `baton_capture` / `baton_resume` / `baton_status` tool calls behave
   identically to the CLI commands (JSON-parity test).
8. Engine tools appear in Hermes' tool list and dispatch without any registry
   registration (per Hermes' engine-tool contract).
9. Fork/merge remain user-driven operations (CLI or MCP); the engine never
   merges automatically.
10. No network calls; all writes are local project writes under `.baton/`.

## 10. Testing strategy

| Layer | Coverage |
|---|---|
| Bridge | Recorded CLI JSON fixtures; subprocess failure injection (missing CLI, non-zero exit, malformed JSON) → degradation path. |
| Engine vs ABC | The Hermes contract suite's shape: `isinstance(ContextEngine)`, `name == "baton"`, `compress()` returns valid OpenAI-format messages, required attributes maintained. |
| Cycle | Simulated `update_from_response` sequences → `should_compress` truth table (explicit request, token fallback, detector thresholds, cooldown). |
| Compaction outputs | Golden-file test: same session state → same message list; brief ≤ budget; STALE banner on head drift. |
| Policy | Secret fixtures redacted; transcript field injected → draft flagged, validation fails, degradation notice. |
| Tools | `baton_capture`/`baton_resume`/`baton_status` parity with CLI JSON. |
| Integration | A scripted Hermes-like driver calling the ABC lifecycle (start → update → compress → end → reset) against a temp git project, asserting on-disk artifacts. |

The Python tests run with pytest in CI alongside the TypeScript suites; the
contract test does **not** import Hermes source — it stubs the ABC shape so
core schema evolution never depends on a vendor release (spec §15 principle).

## 11. Out of scope for v0.1

- Replacing Hermes' memory provider or model-provider systems.
- Auto-activating the engine (Hermes forbids this; user must select Baton).
- In-process embedding of the TypeScript core (bridge-only).
- Cross-harness handoff UIs beyond the existing skill/CLI/MCP surfaces.
