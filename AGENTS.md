# AGENTS.md — Baton contributor field guide

Instructions for AI coding agents (and humans) working in this repository.
Read this before changing anything non-trivial; it encodes the build order,
the sharp edges, and the development loop this repo is designed around.

**Product name:** Baton. **Historical name:** `threadline` — appears only in
legacy-compat code paths (`.threadline/` discovery, schema `$id` dual
readers, migration). Do **not** reintroduce it in new code, docs, or
identifiers.

## The one-paragraph mental model

Baton captures **handoffs**: validated, versioned JSON documents under
`.baton/` that let a coding agent put a task down and pick it back up.
Everything is a surface over `@baton/core`: the CLI, the MCP server, the
generic adapter, and the Python Hermes context-engine plugin (a subprocess
bridge to the CLI). If you are adding behavior, it almost always belongs in
core; the surfaces stay thin.

## Repository map

```
baton/
├── packages/
│   ├── core/              # Everything: schema, store, policy, detector,
│   │                      #   rendering, lineage, migration, logger
│   ├── cli/               # baton binary (commander) + SQLite index
│   ├── mcp/               # MCP server (handoff_* tools over stdio)
│   ├── adapter-sdk/       # Adapter interface + types
│   └── adapter-generic/   # Generic harness adapter (bin: baton-adapter-generic)
├── plugins/context_engine/baton/   # Hermes plugin (Python): abc.py, bridge.py,
│   │                               #   engine.py, config.py
├── docs/                  # VitePress site → GitHub Pages (workflow: docs.yml)
│   └── guide/             # Includes the two normative specs:
│                          #   spec.md (core), hermes-adapter-spec.md
├── schemas/               # GENERATED JSON Schemas — never hand-edit
├── skills/                # Agent skills (baton/ + per-harness wrappers)
├── tests/e2e/             # CLI end-to-end suite (spawns real binary)
├── tests/python/          # Hermes bridge contract + real-CLI parity (pytest)
└── examples/              # minimal-project + adapter events
```

## Development graph (what depends on what)

```
adapter-sdk ─┐
             ├─▶ core ◀─ (zod source of truth)
             │   ▲
      cli ───┴───┴──▶ mcp
        │
        └──▶ adapter-generic (imports cli dist for e2e)

python bridge ──subprocess──▶ cli dist (JSON in/out, --json everywhere)
docs ──embeds──▶ schemas/*.json (generated from core Zod)
```

Build order matters: **core → (cli, mcp, adapters) → docs**. The Python
bridge and e2e suite require the CLI `dist/` to exist. `pnpm -r run build`
handles the ordering via workspace deps; a bare `pnpm --filter X build` may
need its dependencies built first.

## Commands

Use **mise** (`mise install` once, then `mise run <task>`); every task
mirrors CI:

| Task | Does |
| --- | --- |
| `mise run build` | Build all packages (core first) |
| `mise run typecheck` | tsc --noEmit across packages |
| `mise run lint` | Repo lint script across packages |
| `mise run test` | Unit tests (core, cli, mcp, adapters) |
| `mise run test:e2e` | CLI e2e suite (needs build) |
| `mise run test:py` | pytest bridge suite (needs build) |
| `mise run emit:schemas` | Regenerate `schemas/*.json` from Zod |
| `mise run schemas:check` | CI drift check (exit 1 on drift) |
| `mise run docs:dev` / `docs:build` | Local docs server / static build |

Raw pnpm equivalents exist in `package.json` and `mise.toml` if you don't
use mise.

## The schema-driven development loop

**Zod is the single source of truth.** The JSON Schemas in `schemas/` are
generated artifacts; the drift test fails CI if they are hand-edited.

1. Change the Zod schema in `packages/core/src` (`schema.ts` = handoff,
   `projectInit.ts` = config, `detect/index.ts` = adapter event).
2. `pnpm emit:schemas` — regenerates `schemas/*.json`.
3. Add/adjust **fixtures** under `packages/core/tests/fixtures/` and wire
   them into `tests/schemas.test.ts` (ajv validates JSON against the
   emitted schema; the Zod parse validates the same objects in TS).
4. Bump `SCHEMA_VERSION` and the emitted `$id`/filename **only** for
   breaking changes; v0.1 readers accept legacy `threadline.dev` `$id`s.
5. Run `mise run test` — the idempotence test re-emits and byte-compares.

If you add a new persisted document type: create the Zod schema, export it
from `core/src/index.ts`, add it to `packages/core/scripts/emitSchemas.mjs`,
emit, and add a reference page under `docs/schemas/`.

## Sharp edges (things that have bitten us)

- **ESM only.** `"type": "module"` everywhere. Never `require()`; imports
  of local files need the `.js` extension in source (`.ts` on disk).
- **Windows-safe shells.** Terminal commands run under Git Bash on Windows —
  use POSIX syntax (`mv` not `move`, `/dev/null` not `nul`).
- **`outDir` in tsconfig.base.json is gone on purpose.** `outDir` resolves
  relative to the *base* file, so per-package `tsconfig.build.json` files
  declare their own emit directories. Don't "helpfully" re-centralize it.
- **IDs.** `shortId` uses the *random tail* of the UUIDv7, not the leading
  timestamp hex — same-millisecond creations used to collide. File names
  embed the tail, so lookups match on it.
- **Deep-copy test fixtures.** Tests that mutate a handoff must deep-clone
  (`structuredClone`); a shallow spread corrupted sibling tests once.
- **SQLite NOT NULL.** Index upserts must always supply concrete values —
  an `undefined` field once tripped a fresh-insert NOT NULL violation.
  Remember: fresh insert and update paths differ.
- **Commander flag order.** `--json` is a *global* option: it goes before
  the subcommand (`baton --json list`). Some options are per-subcommand;
  check `main.ts` before assuming placement.
- **Exit codes are contract.** `0` ok, `2` user/input error,
  `3` validation failure, `4` not found/conflict, `5` policy/security
  block (see `packages/cli/src/exitCodes.ts`). The e2e suite and the
  Python bridge assert them.
- **The bridge fails soft.** `bridge.py` degrades instead of raising so a
  context engine never crashes the host harness. `doctor` exit 2 means
  "not initialized" there, not "error".
- **VitePress SSR.** Pages prerender on Node: no `document`/`window` in
  inline scripts. Client-only DOM goes in a Vue component
  (`.vitepress/theme/`), e.g. `SchemaViewer.vue`.
- **pnpm workspace scopes.** `-w` adds go to the *root*; use
  `pnpm add -D --filter <pkg>` to land a dep inside a package.
- **`.baton` vs `.threadline`.** All new code goes through
  `resolveBatonDir()` (core) which prefers `.baton` and falls back to a
  legacy `.threadline` directory. Never `join(root, ".baton")` directly.

## Testing posture

- **Unit tests** live beside each package (`packages/*/tests/`).
- **E2E** (`tests/e2e/e2e.test.ts`) builds the real binary and drives it in
  temp git repos — including both migration paths (pure move and merge).
  Extend this for any new CLI behavior.
- **Python** (`tests/python/`) has two layers: hermetic fake-CLI contract
  tests, and real-CLI parity tests that spawn the actual built `main.js`.
  The Hermes ABC is *duck-typed* in `abc.py`; the plugin never imports
  Hermes source.
- **Schema tests** (`packages/core/tests/schemas.test.ts`) validate the
  emitted JSON Schemas against real fixtures with ajv (with `ajv-formats`)
  and check emission idempotence via the emitter's `--check` mode.

## Where the normative truth lives

- `docs/guide/spec.md` — core spec: schema (§7), policy (§16), detection,
  e2e layer (§18), acceptance (§22). When code and spec disagree, fix the
  code or the spec explicitly — never leave them diverging silently.
- `docs/guide/hermes-adapter-spec.md` — adapter contract: ABC mapping,
  compaction cycle, fail-soft rules, rename scope.

## Conventions

- Commits: imperative mood, scope in subject (`cli: ...`, `core: ...`).
- No code comments narrating *what* — comment *why* and cite spec sections.
- Public API of core is the barrel in `core/src/index.ts`; surfaces (cli,
  mcp, adapters) import from `@baton/core` only.
- Generated artifacts (`schemas/*.json`, `dist/`, `docs/.vitepress/dist`,
  `docs/public/schemas`) are never hand-edited; regenerators exist for all
  of them.
