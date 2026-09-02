# Baton

**Portable continuity for AI-agent work.**
A local-first, harness-agnostic, automatic session-handoff layer.

Baton does not replace your agent harness. It detects when a session
should end, packages verified working state into a portable handoff, and lets
the next agent or session resume with a clean, purposeful context — without
re-reading the old chat.

- **Local-first & inspectable** — handoffs are human-readable JSON files under
  `.baton/handoffs/`; an optional SQLite index is rebuildable and never
  the source of truth.
- **Verified continuity** — decisions vs. evidence are separated; schema,
  paths, secrets, git state, and freshness are validated before a handoff is
  marked ready, and a deterministic continuity score measures handoff
  quality before it is trusted.
- **Negative knowledge** — failed approaches are first-class records: the
  resume brief renders an explicit **Do not retry** section so successors
  never re-walk dead ends.
- **Harness-agnostic** — a CLI plus a portable skill today; thin MCP/adapter
  integrations where your harness supports them.
- **Safe automation** — the detector recommends and prepares drafts; it never
  terminates or launches sessions.

The normative documents are the [core spec](./docs/guide/spec.md) and the
[Hermes adapter spec](./docs/guide/hermes-adapter-spec.md); the full
documentation site lives in [`docs/`](./docs) and is published to GitHub
Pages on every push to `main`.

## Repository layout

```text
packages/
  core/        domain library: schema, storage, validation, detector, render, lineage
  cli/         terminal UX, filesystem/git adapters, SQLite index
  mcp/         stdio MCP server (9 tools) wrapping core
  adapter-sdk/ normalized event & adapter interfaces
  adapter-generic/ reference shell/event adapter
plugins/
  context_engine/baton/  Hermes agent context-engine plugin (Python bridge)
skills/        portable agent skill + per-harness wrappers
schemas/       GENERATED JSON Schemas (emit from Zod; never hand-edit)
examples/      minimal project, ready handoff, adapter events
docs/          VitePress site (guide, specs, schema reference) → GitHub Pages
tests/         e2e suite + Python bridge contract suite
AGENTS.md      contributor field guide: map, dev graph, sharp edges
mise.toml      pinned toolchain + dev task graph
```

## The five-minute handoff

Requires Node 20+. From the repo root: `pnpm install && pnpm build`.

```bash
# 1. In your project (any git project works)
cd /path/to/your-project

# Adjust the path to your checkout, or `npm i -g` the CLI package:
alias baton="node /path/to/baton/packages/cli/dist/main.js"

# 2. Initialize Baton (creates .baton/, touches no global git config)
baton init

# 3. Work with your agent as usual… then capture a checkpoint at a boundary
baton checkpoint create \
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
baton handoff validate 0198c0de
baton handoff ready 0198c0de

# 5. Open a NEW terminal/session (same project, any harness) and resume
baton handoff list --status ready
baton resume 0198c0de
```

The resume brief is a bounded, vendor-neutral prompt: objective, current
state, constraints, decisions, artifacts, evidence, failed approaches (an
explicit **Do not retry** list), risks, the first next action, and a final
instruction to verify freshness. Freshness is reported as a derived state —
`fresh`, `partially_stale`, `stale`, or `unknown` — and a stale or drifted
repository renders a prominent warning first. The resume JSON also carries
`quality`, the deterministic continuity score.

Prefer paste-into-chat? `baton resume <id> --format md` renders the full
record as Markdown, or feed it to your agent through the skill in
[`skills/baton/SKILL.md`](./skills/baton/SKILL.md).

## Agents and MCP

Start the stdio MCP server and register it with Codex, Gemini CLI, or any MCP
client:

```bash
node /path/to/baton/packages/mcp/dist/server.js
```

Tools: `baton_status`, `handoff_capture`, `handoff_validate`,
`handoff_ready`, `handoff_resume`, `handoff_list`, `handoff_fork`,
`handoff_merge`, `handoff_detect`. The server performs local project writes
only, requires an initialized project, and exposes no shell-execution tool.

## Automatic detection

```bash
baton detect --event '{"harness":"generic","signals":{"contextPressure":0.92,"resumeReadiness":0.9}}'
```

Scores are deterministic and auditable: the output shows the inputs actually
used, the reasons, and the recommended action (`none` / `recommend` /
`prepare`). Signals cover context/turn/elapsed pressure, work boundaries,
explicit requests, uncommitted changes, repeated blockage, semantic phase
changes, unresolved questions, and session age. Add `--prepare` to create a
draft at `prepare` level. Explicit requests always create a draft; repeated
prompts are suppressed for 20 minutes or until a material change. Weights and
thresholds live in `.baton/config.json` (see `docs/guide/configuration.md`).

## Development

Requires Node 22+ and pnpm 10+. With [mise](https://mise.jdx.dev) installed,
`mise install` pins the whole toolchain (node, pnpm, python, pytest) and
`mise tasks` lists the task graph.

```bash
pnpm install
pnpm build        # core → cli → mcp → adapters
pnpm typecheck    # strict TS across the monorepo
pnpm lint         # per-package architecture lints
pnpm test         # unit tests (core/cli/mcp/adapters) + e2e suite
pnpm test:e2e     # end-to-end handoff/resume against the built CLI & MCP server
pnpm test:py      # Hermes bridge contract + real-CLI parity (pytest)

# JSON Schemas are generated from the Zod source of truth:
pnpm emit:schemas          # regenerate schemas/*.json
pnpm emit:schemas --check  # CI drift check (exit 1 on drift)

# Documentation site (VitePress):
pnpm --filter @baton/docs dev    # local dev server
pnpm --filter @baton/docs build  # static build (also runs on CI → Pages)
```

Working on the repo with an AI agent? Read [`AGENTS.md`](./AGENTS.md) —
it maps the package graph, the schema-driven development loop, and the
sharp edges, and makes `mise run ci` (build → typecheck → lint → tests →
pytest → schema drift → gitleaks) mandatory before every push.

CI runs build, typecheck, lint, tests, e2e, and the pytest suite on macOS,
Linux, and Windows (Node 22); docs deploy to GitHub Pages on pushes to
`main` (`.github/workflows/docs.yml`).

Exit codes (all commands, with or without `--json`): `0` success, `2`
user/input error, `3` validation failure, `4` not found/conflict, `5`
policy/security block.

## Privacy

No network, telemetry, or cloud sync. Secret-like values are redacted before
write with the redaction recorded by field path only. Transcript-bearing
fields are rejected by policy. See [`docs/guide/security.md`](./docs/guide/security.md).

## License

MIT
