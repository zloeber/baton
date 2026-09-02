# CLI reference

The `baton` binary is built from `packages/cli`. Run `baton --help` for the
authoritative list; this page mirrors it.

## Global options

| Flag | Effect |
| --- | --- |
| `--json` | Emit stable machine-readable JSON (place **before** the subcommand) |
| `--project <dir>` | Project root; defaults to the nearest `.baton` directory |
| `--version` | Print version |

## `baton init`

Initialize `.baton/` in the current project.

| Flag | Effect |
| --- | --- |
| `--project-id <id>` | Explicit project id instead of the derived one |
| `--migrate-legacy` | Also adopt an existing `.threadline/` directory (consent flag) |

## `baton migrate [--dry-run]`

Move a legacy `.threadline/` directory to `.baton/` (consent required).
`--dry-run` prints the plan — move or merge, target names, conflicts —
without touching the filesystem. The legacy state file is preserved as
`.threadline.legacy` for rollback.

## `baton session begin`

Record session metadata allowed by policy.

| Flag | Effect |
| --- | --- |
| `--harness <name>` | Harness name (default `generic`) |
| `--session-id <opaque-id>` | Externally supplied session id (hashed per policy) |

## `baton checkpoint create`

Create a draft checkpoint from structured fields. All list-typed fields
accept repeated JSON arguments, or the whole payload can come from a file
via `--input <json-file>` (flags win over file values).

| Flag | Effect |
| --- | --- |
| `--title <text>` | Title (required unless provided via `--input`) |
| `--objective <text>` | Objective |
| `--current-state <text>` | Current state |
| `--completed <items...>` | Completed items |
| `--constraints <items...>` | Constraints |
| `--open-item <json...>` | Open items as JSON objects |
| `--decision <json...>` | Decisions as JSON objects |
| `--evidence <json...>` | Evidence records as JSON objects |
| `--artifact <json...>` | Artifacts as JSON objects |
| `--risk <json...>` | Risks as JSON objects |
| `--from <id>` | Parent handoff id (continuation) |
| `--trigger <name>` | `manual` \| `threshold` \| `hook` \| `timeout` \| `pre_compaction` |
| `--input <json-file>` | Read the full checkpoint payload from a JSON file |

## `baton handoff prepare`

Prepare a handoff draft with prefilled git/session metadata.

| Flag | Effect |
| --- | --- |
| `--from <checkpoint>` | Parent checkpoint id |
| `--trigger <name>` | `manual` \| `threshold` \| `hook` |
| `--title`, `--objective`, `--current-state` | Field overrides |
| `--input <json-file>` | JSON payload merged into the draft |

## `baton handoff validate <id>`

Run the deterministic policy checks. `--recheck` re-runs only allowlisted
command/test evidence.

## `baton handoff ready <id>`

Promote a validated handoff to ready (immutable afterwards).
`--accept-warnings <reason>` acknowledges validation warnings with a
recorded reason.

## `baton handoff list`

List handoffs. Filter with `--status <status>` and `--work <query>` (title
substring).

## `baton handoff show <id>`

Show a handoff record: `--format json` (default), `yaml`, `md`, or `prompt`.

## `baton resume <id>`

Render a resume brief. `--format prompt` (default) emits the bounded
prompt brief; `md` renders the full record as Markdown; `json` returns the
structured payload. `--mark-resumed` marks the handoff resumed in the
index.

## `baton fork <id> --label <label>`

Fork a handoff into an immutable linked child.

## `baton merge <a> <b>`

Merge two handoffs; requires an explicit resolution when decisions
conflict. `--title` overrides the merged title; `--resolution-file <path>`
supplies a JSON file with `objective` / `current_state` / `decision`.

## `baton detect`

Score handoff pressure from normalized signals. `--event <json>` feeds an
adapter event; `--prepare` creates a draft when the recommended action is
`prepare`. Output shows the inputs used, the reasons, and the recommended
action (`none` / `recommend` / `prepare`).

## `baton audit [id]`

Enumerate data fields, redactions, and refs for the project or one handoff.

## `baton lineage`

Show the handoff lineage graph (forks, merges, continuations).

## `baton metrics [--local]`

Local metrics from the index — no outbound analytics; `--local` is
explicitly local-only (always the case in v0.1).

## `baton doctor`

Check project, config, git, and index health; reports legacy-directory
notices.

## `baton gc [--dry-run]`

Remove the rebuildable index/cache only — never canonical records.

## Exit codes

All commands, with or without `--json` (see
`packages/cli/src/exitCodes.ts`):

| Code | Meaning |
| --- | --- |
| `0` | Success |
| `2` | User/input error (usage and precondition failures, e.g. not initialized) |
| `3` | Validation failed |
| `4` | Not found / conflict |
| `5` | Policy/security block |
