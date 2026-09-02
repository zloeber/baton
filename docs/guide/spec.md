# Baton

**Portable continuity for AI-agent work.**  
*A local-first, harness-agnostic automatic session-handoff layer.*

**Status:** implementation specification / POC v0.1  
**Repository name:** `baton`  
**Primary differentiator:** Baton does not replace an agent harness. It detects when a session should end, packages verified working state into a portable handoff, and lets the next agent/session resume with a clean, purposeful context.

---

## 1. Vision

Long-running agent work should be continuous even when individual contexts, models, terminals, or harnesses are not. Baton makes continuity an explicit, inspectable project artifact rather than an accidental by-product of chat history or an opaque context compaction.

The product is a small local tool that works alongside Claude Code, Codex, Cursor, Gemini CLI, and open-source harnesses. It records the minimum durable state needed to continue work correctly: intent, verified facts, decisions, changed artifacts, evidence, risks, and the next executable actions. A fresh session can hydrate from that record without importing a long, lossy conversation transcript.

## 2. Problem

Automatic context compaction keeps one conversation alive by summarizing its past. That helps with token limits, but it is usually opaque, mixes durable project knowledge with temporary narration, and can silently lose essential constraints or validation evidence.

Agent users also regularly switch:

- because a context is full or the agent is stuck;
- between local and cloud agents, models, machines, or harnesses;
- from one parallel workstream to another; and
- between human and agent ownership.

Today that transition is often manual: copy a prompt, summarize a chat, or hope a repository contains enough clues. Baton provides a portable, validated, versioned continuity record and an optional automatic handoff trigger.

## 3. Goals and non-goals

### Goals

1. **Meet users in their current harness.** Offer a CLI first, then thin skills/hooks/MCP adapters; require no harness replacement.
2. **Local-first and inspectable.** Store handoffs as human-readable JSON/YAML plus optional local SQLite index; work fully offline.
3. **Fresh-context resumption.** Generate a compact, high-signal resume brief and machine-readable state for any capable agent.
4. **Verified continuity.** Distinguish claims from evidence; validate schema, files, commands, repository state, and freshness before a handoff is marked ready.
5. **Safe automatic handoffs.** Score pressure and readiness, propose/prepare automatically, but never silently terminate a user session in the MVP.
6. **Lineage-aware collaboration.** Preserve parent/child relationships, support forks and explicit merges, and expose conflicts instead of concealing them.
7. **Portable protocol.** Keep a stable canonical schema independent of vendor APIs and model-specific prompts.

### Non-goals (MVP)

- Building a chat UI, hosted agent runtime, memory database, or replacement IDE/harness.
- Capturing every token, chain of thought, terminal keystroke, or full transcript.
- Solving cross-agent semantic merge automatically.
- Synching handoffs to a cloud service by default.
- Reading credentials, secrets, private system prompts, or arbitrary files outside the selected project.
- Guaranteeing automatic detection of a harness's remaining context window when the harness does not expose it.

## 4. Product principles

- **State, not story:** retain decisions and evidence, not a narrative of every turn.
- **Portable by default:** a handoff must remain useful as a file without Baton installed.
- **Structured first, rendered second:** write canonical data; render prompts/Markdown from it.
- **Human retains control:** automation recommends and prepares; users approve consequential boundaries.
- **Evidence earns trust:** every important claim should point to a command, file, test, URL, or user decision.
- **Graceful degradation:** the CLI works everywhere; richer integrations are optional adapters.
- **No hidden memory:** surface what was included, redacted, stale, or unable to be validated.

## 5. Terminology and core concepts

| Term | Meaning |
|---|---|
| **Project** | A directory/repository whose continuity records share a configuration and identity. |
| **Session** | One bounded period of agent/human work in any harness. |
| **Handoff** | An immutable versioned snapshot of enough verified state to continue a work item. |
| **Resume brief** | A compact, human- and agent-readable rendering of a handoff. |
| **Work item** | The concrete objective currently being pursued. |
| **Evidence** | A reproducible reference supporting a claim: command result, file range, commit, URL, or human confirmation. |
| **Checkpoint** | A draft handoff captured during a session; it is not necessarily ready to resume from. |
| **Lineage** | The directed graph connecting handoffs by continuation, fork, or merge. |
| **Adapter** | A harness-specific integration that maps an event or UI affordance to the canonical CLI/API. |

### Handoff states

`draft` → `validated` → `ready` → `resumed` → `superseded` or `archived`.

`invalid` and `conflicted` are terminal-until-revised flags, not replacements for the state field. A handoff is immutable after `ready`; updates create a new revision with a parent link.

## 6. Architecture

```text
Harness / editor / human
  Claude Code · Codex · Cursor · Gemini CLI · custom agent
                         │ hooks, skill, MCP, or direct CLI
                         ▼
                 Baton core CLI
       capture · validate · score · render · lineage
                         │
          ┌──────────────┴───────────────┐
          ▼                              ▼
 .baton/handoffs/*.json       .baton/index.sqlite
 canonical, git-friendly records   rebuildable local index
          │
          └──────────────┬───────────────┘
                         ▼
                 MCP server (optional)
       tools for agents; wraps the same core library
```

Implementation: TypeScript, Node.js 20+, `zod` for schema validation, `commander` (or `clipanion`) for CLI, `better-sqlite3` or `sqlite` for the optional index, and the official MCP TypeScript SDK. The domain library must have no MCP, terminal, or vendor SDK dependency.

## 7. Canonical handoff schema

### 7.1 Format and storage contract

The canonical on-disk format is UTF-8 JSON, schema versioned, one handoff per file. JSON is chosen for reliable validation and MCP interchange; `baton show --format yaml|md|prompt` provides friendly views. Unknown top-level fields must be preserved by readers for forward compatibility.

File name: `.baton/handoffs/<created-at>--<short-id>.json` (UTC RFC 3339 timestamp with punctuation removed). The file contents include the definitive UUID.

### 7.2 JSON Schema–shaped model

```json
{
  "$schema": "https://baton.dev/schemas/handoff/v0.1.json",
  "schema_version": "0.1",
  "id": "018f...uuidv7",
  "kind": "handoff",
  "status": "ready",
  "created_at": "2026-09-02T14:30:00Z",
  "updated_at": "2026-09-02T14:32:00Z",
  "project": {
    "id": "sha256:...",
    "root_hint": ".",
    "repository": {"vcs": "git", "remote_hint": "github.com/org/repo", "head": "abc123", "dirty": true}
  },
  "origin": {
    "harness": "codex|claude-code|cursor|gemini-cli|generic",
    "adapter_version": "0.1.0",
    "session_id": "optional-non-secret-id",
    "model": "optional descriptive model id",
    "actor": {"type": "agent|human|mixed", "name": "optional"}
  },
  "work": {
    "title": "Implement resumable OAuth callback validation",
    "objective": "... measurable desired outcome ...",
    "scope": ["src/auth/**", "tests/auth/**"],
    "constraints": ["Do not change public callback URL"],
    "definition_of_done": ["Tests pass", "Invalid state is rejected"]
  },
  "summary": {
    "completed": ["Added state comparison helper"],
    "current_state": "Tests are written; one integration fixture remains.",
    "why_it_matters": "Prevents callback replay."
  },
  "decisions": [{
    "id": "D-001",
    "decision": "Use timing-safe comparison for state values.",
    "rationale": "Avoid distinguishable comparisons for a secret-derived value.",
    "alternatives_considered": ["Plain equality"],
    "evidence_ids": ["E-002"],
    "made_at": "2026-09-02T14:20:00Z"
  }],
  "artifacts": [{
    "path": "src/auth/callback.ts",
    "role": "modified|created|read|generated",
    "description": "Validation entry point",
    "revision": "git:abc123",
    "content_hash": "sha256:optional",
    "sensitive": false
  }],
  "evidence": [{
    "id": "E-002",
    "type": "command|test|file|commit|url|human",
    "claim": "Unit tests passed after helper change.",
    "ref": "npm test -- auth/callback.test.ts",
    "captured_at": "2026-09-02T14:25:00Z",
    "result": "pass",
    "digest": "sha256:optional redacted output digest"
  }],
  "open_items": [{
    "id": "O-001",
    "priority": "high|medium|low",
    "description": "Add integration fixture for a duplicate callback.",
    "suggested_action": "Create fixture, run focused suite, then full suite.",
    "blocked_by": [],
    "acceptance_check": "Fixture proves replay is rejected."
  }],
  "risks": [{"description": "Working tree has unrelated changes.", "severity": "medium", "mitigation": "Inspect diff before commit."}],
  "validation": {
    "status": "pass|warn|fail|not_run",
    "validated_at": "2026-09-02T14:32:00Z",
    "checks": [{"name": "schema", "status": "pass", "detail": ""}],
    "freshness": {"git_head_at_capture": "abc123", "git_head_now": "abc123", "stale": false}
  },
  "lineage": {
    "parents": ["optional prior handoff UUID"],
    "relation": "root|continue|fork|merge|amend",
    "branch_label": "optional human label",
    "merge_basis": ["fork ids when relation is merge"]
  },
  "automation": {
    "trigger": "manual|threshold|hook|timeout|pre_compaction",
    "score": 0.82,
    "reasons": ["reported context pressure", "validated open work"]
  },
  "redactions": [{"field": "evidence[0].ref", "reason": "matched secret policy", "replacement": "[REDACTED]"}]
}
```

Required fields for `draft`: schema/id/kind/status/timestamps/project/work/summary/lineage. Required to become `ready`: all draft requirements plus at least one `open_item` or an explicit completed work state, validation status `pass` or user-acknowledged `warn`, and no secret-policy violation. Arrays may be empty only when semantically appropriate.

## 8. Lifecycle

1. `baton init` creates `.baton/config.json`, `.baton/handoffs/`, and a starter ignore policy. It must not modify a global Git configuration.
2. A user or adapter opens a session with `baton session begin` (optional in MVP). It records only metadata allowed by policy.
3. During work, `checkpoint` captures a draft from supplied structured fields, optionally records Git state and command/test evidence.
4. The detector calculates **handoff pressure** and **handoff readiness**. It may issue a prompt or invoke a configurable callback; it never kills a process or starts another agent in MVP.
5. `validate` runs deterministic checks. A ready handoff is persisted immutably and receives a resume token/ID.
6. The user starts any new session and runs `baton resume <id>` or an adapter calls the equivalent MCP tool. It renders a compact brief, marks the record `resumed` in the local index, and may create a child work session.
7. The new session either continues from the handoff or forks it. Completing a fork creates a child; combining work requires `merge` with a written resolution summary.

## 9. Automatic handoff detection and scoring

Baton supports partial signals. It must plainly display unavailable signals rather than guessing.

### 9.1 Inputs (normalized 0–1)

- `context_pressure`: harness-reported context-used ratio; otherwise `null`.
- `turn_pressure`: current turns / configured soft turn budget.
- `elapsed_pressure`: session elapsed time / configured soft duration.
- `work_boundary`: agent/user declares a completed subtask, decision, test result, or phase transition.
- `handoff_request`: explicit “handoff”, “continue later”, “new session”, or adapter event.
- `change_pressure`: uncommitted relevant changes or an advanced Git head since last checkpoint.
- `stuck_signal`: repeated failing action/error fingerprint, or explicit user/agent declaration; optional and conservative.
- `resume_readiness`: required fields populated + validation success + actionable next item.

### 9.2 Score

```
pressure = max(
  1.00 * explicit_request,
  0.70 * context_pressure + 0.15 * turn_pressure + 0.10 * elapsed_pressure + 0.05 * change_pressure,
  0.60 * stuck_signal + 0.25 * work_boundary + 0.15 * change_pressure
)

recommend = pressure >= 0.70
auto_prepare = pressure >= 0.85 AND readiness >= 0.80
```

Default behaviors:

- At `recommend`, show a non-blocking message with “prepare handoff”, “snooze”, and “disable for this session.”
- At `auto_prepare`, create a **draft** checkpoint and ask for missing fields/approval before it can become `ready`.
- An explicit request always creates a draft, regardless of score.
- Repeated prompts are suppressed for 20 minutes or until a material event occurs.

All weights and thresholds belong in `.baton/config.json`. The detector must store the score, inputs actually used, and reasons in the handoff; this makes its recommendation auditable and tunable.

## 10. Validation and freshness

`baton validate <id>` runs:

1. **Schema:** valid version, UUID, enum values, required fields, referential integrity (`evidence_ids`, parent IDs).
2. **Policy:** no fields violate configured secret/path/privacy policies; no raw transcript field is accepted in v0.1.
3. **Artifact:** each project-relative referenced path exists (unless marked deleted), is inside root, and optional content hashes match.
4. **Repository:** captured Git head and dirty state are recorded; validate reports, but does not fail solely for, subsequent drift.
5. **Evidence:** command/test records are structurally well-formed; commands are never re-run by default. `--recheck` may re-run only explicitly allowlisted checks.
6. **Actionability:** objective present, and either definition-of-done is satisfied or an open item includes suggested action and acceptance check.
7. **Lineage:** parents exist when locally known; a merge contains at least two parents and a merge-resolution decision.

Validation returns JSON suitable for automation and a terse terminal summary. `warn` requires `--accept-warnings <reason>` to promote to ready. `fail` cannot be promoted without amendment.

On resume, perform a fast freshness check against current Git head/path hashes. Render a prominent **STALE** section if relevant files or branch state changed; do not silently apply assumptions from a stale handoff.

## 11. CLI contract

All commands support `--json` with stable machine-readable output and exit codes: `0` success, `2` user/input error, `3` validation failure, `4` not found/conflict, `5` policy/security block.

```text
baton init [--project-id <id>]
baton session begin [--harness <name>] [--session-id <opaque-id>]
baton checkpoint create --title <text> --objective <text> [--from <id>]
baton handoff prepare [--from <checkpoint>] [--trigger manual|threshold|hook]
baton handoff validate <id> [--recheck]
baton handoff ready <id> [--accept-warnings <reason>]
baton handoff list [--status ready] [--work <query>]
baton handoff show <id> [--format json|yaml|md|prompt]
baton resume <id> [--format prompt] [--mark-resumed]
baton fork <id> --label <label>
baton merge <id> <id> [--title <text>] [--resolution-file <path>]
baton detect [--event <json>] [--prepare]
baton doctor
baton gc [--dry-run]  # only removes rebuildable local index/cache, never canonical records
```

MVP input ergonomics: interactive prompts when attached to a terminal; flags and `--input <json-file>` for automation. `handoff prepare` should prefill Git metadata, changed files, current working objective/session data, and a template for the operator/agent to complete—not invent summary facts.

`resume --format prompt` produces a vendor-neutral bounded brief (target ≤1,200 tokens by default): objective, current state, non-negotiable constraints, decisions, relevant artifacts, validated evidence, risks, first next action, and a final instruction to verify freshness. It never embeds secret-redacted values.

## 12. Agent skill

Ship a portable `skills/baton/SKILL.md` plus harness wrappers. The skill must direct agents to:

1. Read `.baton/config.json` and the selected/most recent ready handoff at session start.
2. Treat its constraints, decisions, open items, and freshness status as working context, not unquestionable truth.
3. Add evidence as work occurs; never fabricate a test result, command result, or decision.
4. Checkpoint at meaningful boundaries; prepare a handoff before declared context exhaustion, agent transfer, extended pause, or after repeated blockage.
5. Keep the handoff compact and structured; link to repository artifacts rather than paste large files/transcripts.
6. Run validation before marking ready; report failures rather than bypassing policy.
7. On forks/merges, name the branch purpose and explicitly resolve conflicting decisions.

The skill should include reusable command examples but no vendor-specific instructions. Harness-specific wrappers only explain how to make the CLI/MCP available.

## 13. MCP server and tools

Package `@baton/mcp` as a stdio MCP server. It calls the same core library and honors project root/policy restrictions. Every tool returns structured content plus a concise text summary.

| Tool | Inputs | Result / guardrail |
|---|---|---|
| `baton_status` | project root | config, active/latest handoff, freshness, detector availability. |
| `handoff_capture` | work/summary/decisions/open items/evidence, optional parent | creates a draft only; validates input and redacts policy matches. |
| `handoff_validate` | id, optional `recheck` | check report; recheck requires configured allowlist. |
| `handoff_ready` | id, warning acknowledgement | promotes only after valid checks. |
| `handoff_resume` | id, format | concise brief + freshness report; no implicit file writes except optional session marker. |
| `handoff_list` | filters | metadata summaries, no secret-bearing evidence payload by default. |
| `handoff_fork` | id, label | child draft/session token. |
| `handoff_merge` | parent IDs, resolution | merge draft with explicit conflict resolution. |
| `handoff_detect` | normalized signals | score/reasons/recommended action; does not create by default. |

Do not expose a generic shell execution tool. Command evidence is supplied by the harness/agent or captured through a deliberately scoped CLI action. MCP writes are local project writes only and should require an initialized project.

## 14. Storage, lineage, fork, and merge

### Storage

```text
.baton/
  config.json
  handoffs/
    20260902T143000Z--018f.json
  index.sqlite                 # optional and gitignored; rebuildable
  policy.json                  # optional local policy override
  cache/                       # gitignored; never canonical
```

Canonical handoffs may be committed to Git when teams want an audit trail. For a personal/local workflow, `.baton/handoffs/` can be gitignored. `config.json` defaults to safe project-shareable settings; machine-specific configuration goes in an ignored local override.

The SQLite index accelerates queries and stores ephemeral session/prompt-suppression data. It can always be rebuilt from JSON handoffs, so JSON records remain the source of truth.

### Lineage semantics

- `continue`: one new handoff supersedes a parent; parent remains immutable.
- `fork`: two or more children share a parent. The parent decision set is inherited as context, not copied as mutable data.
- `merge`: a new handoff lists two or more parents, a resolution decision, conflict list, and evidence of reconciled artifacts/tests.
- `amend`: a corrected child of a handoff; do not edit a ready record in place.

Detect conflicting decisions by ID or by same normalized decision subject with differing values. The tool may flag candidates; human/agent must write the resolution. Graph traversal works from records alone; the index is an optimization.

## 15. Interoperability strategy

The universal integration is a shell command plus a Markdown skill. All integrations must be optional and thin.

| Environment | MVP integration | Automation signal | Resume path |
|---|---|---|---|
| Claude Code | Installable project skill; optional hooks wrapper if available | explicit command, stop/pre-compact hook, harness-provided usage if exposed | `/baton-resume`-style skill command or `baton resume`. |
| Codex | Project skill/instructions and MCP configuration | explicit command; agent/session boundary where exposed | MCP `handoff_resume` or CLI-generated brief. |
| Cursor | Project rules/skill plus terminal task | explicit action, user-triggered new chat; avoid relying on undocumented context metrics | paste/rendered resume brief in new chat. |
| Gemini CLI | Project command/extension wrapper and MCP if supported | explicit command, lifecycle hook if stable | CLI or MCP resume. |
| Open-source harnesses | npm package + CLI, documented event adapter interface | normalized `detect --event` JSON | CLI/MCP. |

Adapters implement a tiny interface: `getProjectContext()`, `getSessionMetadata()`, `subscribeEvents?(handler)`, `renderNotice?(recommendation)`. No adapter may require raw messages or hidden prompts. Keep vendor code in separate packages and test it with fixtures so core schema evolution never depends on a vendor release.

## 16. Security and privacy

- Default scope is the current project root. Reject path traversal and references outside root unless the user explicitly configures allowed roots.
- Never read or serialize environment variables, credentials, `.env` contents, auth headers, private prompts, clipboard contents, or full conversation transcripts.
- Redact configurable patterns and paths before write (defaults: common secret key prefixes, PEM blocks, `.env`, credential filenames). Store the field path and reason, never the removed value.
- Treat evidence output as potentially sensitive: store a digest plus a bounded/redacted summary by default, not raw command output.
- Use opaque session IDs; hash or omit externally supplied IDs if configured.
- No network, telemetry, or cloud sync in the MVP. Any future sync must be opt-in, encrypted in transit, project-selective, and retain the same redaction pipeline.
- Support `baton audit` to enumerate data fields, redactions, external refs, and records eligible for user-directed deletion. Do not add automatic destructive retention in v0.1.

## 17. Observability

Local structured logs (JSONL) are disabled by default; enable with `BATON_LOG=info|debug` or config. Logs must contain record IDs and event names, never handoff body values, command output, or secrets.

Capture local metrics in the index only: detector recommendations/preparations, validation outcomes, time-to-ready, resume count, stale-on-resume count, and adapter signal availability. Provide `baton metrics --local` and `baton doctor`. No outbound analytics.

## 18. Testing strategy

| Layer | Required coverage |
|---|---|
| Schema/domain | JSON parsing, forward-compatible unknown fields, state transitions, referential integrity, redaction, path containment. |
| CLI | command success/error exit codes, JSON contract snapshots, non-interactive and interactive fixture runs. |
| Storage | atomic write, interrupted write recovery, index rebuild, concurrent writer lock behavior, Git/no-Git projects. |
| Validation | missing paths, changed hash, stale Git state, warning acknowledgement, recheck allowlist, secret fixtures. |
| Detector | deterministic table-driven scoring, null/missing signals, cooldown, explicit request precedence. |
| Lineage | continuation, fork graph, merge requirements, decision-conflict fixtures. |
| MCP | tool schemas, policy enforcement, core/CLI parity, stdio integration tests. |
| Adapters | contract tests using recorded, non-sensitive vendor event fixtures; no live vendor account required. |
| End-to-end | initialize → capture → validate → ready → fresh resume; stale resume; fork/merge; policy block. |

Use property-based tests for IDs, timestamps, path sanitization, and schema round-trips. Add golden files for the rendered resume brief to prevent prompt-format regressions. Run typecheck, lint, unit tests, integration tests, and package audit in CI; test on macOS, Linux, and Windows where Node support permits.

## 19. MVP milestones

### M0 — Foundation (week 1)

- TypeScript monorepo, core domain types/Zod schema, atomic JSON storage, `init`, `doctor`, and sample handoffs.
- Canonical schema documented and fixtures committed.
- No automatic detector or vendor integration yet.

**Exit:** a handoff JSON file validates and renders deterministically from the core library.

### M1 — Usable local continuity (weeks 2–3)

- CLI capture/prepare/validate/ready/list/show/resume.
- Git metadata/artifact validation, redaction policy, portable skill, concise prompt renderer.
- SQLite index/rebuild, state transitions, and stale-on-resume warnings.

**Exit:** a user can hand off a real local coding task and resume it in a different terminal without reading the old chat.

### M2 — Automated preparation (week 4)

- Normalized detector, configurable score/thresholds, cooldown, `detect --event`, and explicit draft creation.
- Full audit trail of signals/reasons; zero silent session termination.

**Exit:** simulated high context-pressure event offers/prepares a valid draft, while low/noisy signals do not nag.

### M3 — Agent access and lineage (weeks 5–6)

- stdio MCP tools, fork/merge workflow, conflict reporting, local observability.
- Claude Code and Codex thin integration examples; generic adapter SDK/documentation.

**Exit:** one CLI-only and one MCP-only end-to-end workflow pass the same acceptance suite.

### Deferred after MVP

Hosted sync/team sharing, visual lineage UI, native IDE extensions, semantic merge assistance, encrypted remote vault, org policy management, and automatic new-session launch.

## 20. Repository layout

```text
baton/
  README.md
  SPEC.md
  package.json
  pnpm-workspace.yaml
  packages/
    core/                 # types, schema, validation, detector, renderers, lineage
    cli/                  # terminal UX and filesystem/Git adapters
    mcp/                  # stdio MCP server wrapping core
    adapter-sdk/          # normalized event and adapter interfaces
    adapter-generic/      # reference shell/event adapter
  skills/
    baton/SKILL.md
    claude-code/
    codex/
    cursor/
    gemini-cli/
  schemas/
    handoff-v0.1.json
  examples/
    minimal-project/
    handoff-ready.json
    adapter-events/
  docs/
    interoperability.md
    security.md
    configuration.md
  tests/
    fixtures/
    e2e/
  .github/workflows/ci.yml
```

Keep `packages/core` pure and platform-independent. Depend outward: CLI/MCP/adapters may depend on core; core must never import them. Version schema separately from packages and include migration readers before changing a released schema.

## 21. Coding-agent instructions

Use these as repository-level instructions for implementation agents:

1. Read `SPEC.md` and any existing project instructions before editing. Treat the canonical schema and local-first/no-transcript policy as invariant unless the task explicitly changes them.
2. Work in small vertical slices. For each feature, add/update schema fixtures, core tests, CLI/MCP behavior as applicable, and user documentation in the same change.
3. Never fabricate evidence in tests, examples, or generated handoffs. Label fixture data clearly as synthetic.
4. Do not introduce network calls, analytics, cloud storage, a database dependency for canonical data, or vendor SDK imports into core.
5. Use atomic writes and file locking for canonical handoffs. Preserve unknown schema fields on read/write.
6. Make all policy failures explicit; never silently drop a field except through recorded redaction.
7. New CLI output must have a stable `--json` representation and documented exit behavior.
8. Keep adapter code optional. If a vendor surface is unstable or inaccessible, implement the generic adapter and document the integration boundary rather than guessing.
9. Test security boundaries with malicious paths, secret-like strings, stale repositories, and malformed lineage references.
10. Before declaring a task complete, run formatting, typecheck, tests relevant to the change, and an end-to-end handoff/resume fixture. Report exact commands and outcomes in the change summary.

## 22. MVP acceptance criteria

The MVP is ready for a public POC when all of the following are demonstrably true:

1. A fresh local Git project can run `baton init`, create a draft, validate it, mark it ready, and render a resume brief using only the CLI.
2. The ready JSON conforms to `handoff-v0.1.json`, is human-readable, contains no full transcript, and remains usable if the SQLite index is deleted and rebuilt.
3. `resume` clearly flags a changed Git head or changed referenced artifact before presenting next actions.
4. A secret-like value supplied in a capture payload is blocked or redacted according to policy, with the redaction recorded and without persisting the original value.
5. Explicit user handoff requests always create a draft. Simulated pressure scores show their inputs/reasons, honor cooldown, and never terminate or launch a session automatically.
6. A handoff can be resumed in a generic harness using a Markdown prompt and via MCP using `handoff_resume`, with equivalent core state and freshness results.
7. Forking produces immutable linked children; merging two children fails until an explicit resolution decision is supplied.
8. Validation catches malformed schema, missing in-root artifacts, out-of-root paths, invalid evidence references, and unallowlisted recheck commands.
9. The generic adapter contract is documented and tested; at least Claude Code and Codex have copyable, non-invasive integration examples even if their richer lifecycle signals are unavailable.
10. CI passes on supported platforms, and the README’s “five-minute handoff” example works exactly as written.

## 23. First implementation issue set

1. Scaffold monorepo and core schema with sample fixtures.
2. Implement `ProjectStore` with atomic JSON write, ID/timestamp generation, and index rebuild.
3. Implement state machine and deterministic validation report.
4. Implement `init`, `handoff prepare`, `validate`, `ready`, `show`, and `resume` commands.
5. Implement safe policy/redaction engine and path containment checks.
6. Add generic `detect --event` scoring and prompt-suppression index state.
7. Ship `skills/baton/SKILL.md` and generic integration guide.
8. Add MCP server parity layer.
9. Add lineage fork/merge and graph/list rendering.
10. Add vendor examples only after generic E2E flow is stable.

## 24. Success measure

The POC succeeds when a developer can intentionally or automatically prepare a handoff near a session boundary, begin a new session in a different compatible harness, and make correct progress within minutes—without re-reading the prior conversation and without Baton owning their agent workflow.

