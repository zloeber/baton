# Threadline

**Portable continuity for AI-agent work.**
A local-first, harness-agnostic, automatic session-handoff layer.

Threadline does not replace your agent harness. It detects when a session
should end, packages verified working state into a portable handoff, and lets
the next agent or session resume with a clean, purposeful context — without
re-reading the old chat.

- **Local-first & inspectable** — handoffs are human-readable JSON files under
  `.threadline/handoffs/`; an optional SQLite index is rebuildable and never
  the source of truth.
- **Verified continuity** — decisions vs. evidence are separated; schema,
  paths, secrets, git state, and freshness are validated before a handoff is
  marked ready.
- **Harness-agnostic** — a CLI plus a portable skill today; thin MCP/adapter
  integrations where your harness supports them.
- **Safe automation** — the detector recommends and prepares drafts; it never
  terminates or launches sessions.

See [`SPEC.md`](./SPEC.md) for the full product and implementation
specification.

## Repository layout

```text
packages/
  core/        domain library: schema, storage, validation, detector, render, lineage
  cli/         terminal UX, filesystem/git adapters, SQLite index
  mcp/         stdio MCP server (9 tools) wrapping core
  adapter-sdk/ normalized event & adapter interfaces
  adapter-generic/ reference shell/event adapter
skills/        portable agent skill + per-harness wrappers
schemas/       canonical handoff-v0.1.json JSON Schema
examples/      minimal project, ready handoff, adapter events
docs/          interoperability, security, configuration
tests/         fixtures + end-to-end suite
```

## The five-minute handoff

Requires Node 20+. From the repo root: `pnpm install && pnpm build`.

```bash
# 1. In your project (any git project works)
cd /path/to/your-project

# Adjust the path to your checkout, or `npm i -g` the CLI package:
alias threadline="node /path/to/threadline/packages/cli/dist/main.js"

# 2. Initialize Threadline (creates .threadline/, touches no global git config)
threadline init

# 3. Work with your agent as usual… then capture a checkpoint at a boundary
threadline checkpoint create \
  --title "Implement resumable OAuth callback validation" \
  --objective "Reject replayed OAuth state parameters with timing-safe comparison" \
  --current-state "Helper implemented; integration fixture still pending" \
  --completed "Added timing-safe state comparison helper" \
  --decision '{"id":"D-001","decision":"Use timing-safe comparison for state values","rationale":"Avoid distinguishable comparisons for secret-derived values"}' \
  --evidence '{"id":"E-001","type":"test","claim":"Unit tests passed after helper change","ref":"npm test -- auth/callback.test.ts","result":"pass"}' \
  --artifact '{"path":"src/auth/callback.ts","role":"modified"}' \
  --open-item '{"id":"O-001","priority":"high","description":"Add integration fixture for a duplicate callback","suggested_action":"Create fixture, run focused suite, then full suite","acceptance_check":"Fixture proves replay is rejected"}'
# → prints the draft id, e.g. 0198c0de-…

# 4. Validate, then mark ready (immutable afterwards)
threadline handoff validate 0198c0de
threadline handoff ready 0198c0de

# 5. Open a NEW terminal/session (same project, any harness) and resume
threadline handoff list --status ready
threadline resume 0198c0de
```

The resume brief is a bounded, vendor-neutral prompt: objective, current
state, constraints, decisions, artifacts, evidence, risks, the first next
action, and a final instruction to verify freshness. If the repository moved
since capture, a prominent **STALE** section is rendered first.

Prefer paste-into-chat? `threadline resume <id> --format md` renders the full
record as Markdown, or feed it to your agent through the skill in
[`skills/threadline/SKILL.md`](./skills/threadline/SKILL.md).

## Agents and MCP

Start the stdio MCP server and register it with Codex, Gemini CLI, or any MCP
client:

```bash
node /path/to/threadline/packages/mcp/dist/server.js
```

Tools: `threadline_status`, `handoff_capture`, `handoff_validate`,
`handoff_ready`, `handoff_resume`, `handoff_list`, `handoff_fork`,
`handoff_merge`, `handoff_detect`. The server performs local project writes
only, requires an initialized project, and exposes no shell-execution tool.

## Automatic detection

```bash
threadline detect --event '{"harness":"generic","signals":{"contextPressure":0.92,"resumeReadiness":0.9}}'
```

Scores are deterministic and auditable: the output shows the inputs actually
used, the reasons, and the recommended action (`none` / `recommend` /
`prepare`). Add `--prepare` to create a draft at `prepare` level. Explicit
requests always create a draft; repeated prompts are suppressed for 20 minutes
or until a material change. Weights and thresholds live in
`.threadline/config.json` (see `docs/configuration.md`).

## Development

```bash
pnpm install
pnpm build        # core → cli → mcp → adapters
pnpm typecheck    # strict TS across the monorepo
pnpm lint         # per-package architecture lints
pnpm test         # unit tests (core/cli/mcp/adapters) + e2e suite
pnpm test:e2e     # end-to-end handoff/resume against the built CLI & MCP server
```

CI runs all of the above on macOS, Linux, and Windows (Node 22).

Exit codes (all commands, with or without `--json`): `0` success, `2`
user/input error, `3` validation failure, `4` not found/conflict, `5`
policy/security block.

## Privacy

No network, telemetry, or cloud sync. Secret-like values are redacted before
write with the redaction recorded by field path only. Transcript-bearing
fields are rejected by policy. See [`docs/security.md`](./docs/security.md).

## License

MIT
