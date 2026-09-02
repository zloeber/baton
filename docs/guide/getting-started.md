# Getting started

## Prerequisites

- Node.js 22+ (or [`mise`](https://mise.jdx.dev): `mise install` pins
  everything, see [Development](#development))
- pnpm 10+

## Install

```bash
git clone https://github.com/zloeber/baton
cd baton
mise install        # optional but recommended: pins node/pnpm/python
pnpm install
pnpm build
```

The CLI lives at `packages/cli/dist/main.js`. Add a convenience alias:

```bash
alias baton="node /path/to/baton/packages/cli/dist/main.js"
```

## The five-minute flow

### 1. Initialize a project

```bash
cd your-project
baton init
```

This creates `.baton/` with `config.json` and an empty handoff store. Have an
older `.threadline/` directory? `baton init --migrate-legacy` adopts it (see
[Configuration](./configuration#legacy-directories)).

### 2. Capture a checkpoint

```bash
baton checkpoint create \
  --title "Migrate auth to passkeys" \
  --objective "Replace password auth with WebAuthn passkeys" \
  --current-state "Schema migration written; UI pending" \
  --completed "Wrote schema migration" \
  --open-item '{"id":"O-001","priority":"high","description":"Wire up registration UI","suggested_action":"Add the passkey registration form","acceptance_check":"Registration creates a credential"}'
```

The handoff is written as a `draft` under `.baton/handoffs/`.

### 3. Validate

```bash
baton handoff validate <id>
```

Runs the policy engine: completeness, lineage conflict detection, structured
ID checks, redaction verification. Output tells you exactly which checks
failed and why.

### 4. Mark ready

```bash
baton handoff ready <id>
```

Only handoffs that pass validation can be promoted; they are immutable
afterwards.

### 5. Resume

```bash
baton handoff list --status ready   # find the id again
baton resume <id>                   # bounded prompt brief
baton resume <id> --format md       # full record as Markdown
baton resume <id> --format json     # machine-readable
```

The prompt brief is bounded by construction and includes objective, state,
next steps, decisions, and open questions — sized to seed a fresh agent
session without eating the context window. If the repository moved since
capture, a prominent **STALE** section is rendered first.

## Other entry points

- **MCP server** — `baton-mcp` exposes nine `handoff_*` tools over stdio for
  MCP-capable harnesses. See [MCP server](./mcp).
- **Hermes plugin** — the `baton` context engine replaces Hermes' built-in
  compressor. See [Hermes adapter](./hermes-adapter).
- **Generic adapter** — `@baton/adapter-generic` maps arbitrary harness
  events to detector signals and suggests commands.

## JSON Schemas

Every persisted document type has a published JSON Schema under `schemas/`:

| Schema | Source |
| --- | --- |
| [`handoff-v0.1.json`](https://github.com/zloeber/baton/tree/main/schemas) | `HandoffSchema` in `packages/core/src/schema.ts` |
| `config-v0.1.json` | `ConfigSchema` in `packages/core/src/projectInit.ts` |
| `adapter-event-v0.1.json` | `AdapterEventSchema` in `packages/core/src/detect/index.ts` |

These are **generated artifacts** — edit the Zod source, then regenerate:

```bash
pnpm emit:schemas          # rewrite schemas/*.json
pnpm emit:schemas --check  # CI mode: exit 1 if drift
```

## Development

```bash
mise install        # node 22, pnpm 10, python 3.11, pytest
mise run build      # all packages
mise run test       # unit tests
mise run test:e2e   # end-to-end CLI suite
mise run test:py    # Hermes bridge contract suite
mise run docs:dev   # this documentation site, live
```

Run `mise tasks` for the full task graph.
