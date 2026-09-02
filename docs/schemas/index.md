# JSON Schemas

Baton is **schema-driven**: the Zod definitions in `packages/core/src` are
the single source of truth, and the JSON Schemas under
[`schemas/`](https://github.com/zloeber/baton/tree/main/schemas) in the
repository are **generated artifacts** — never edit them by hand.

```bash
pnpm emit:schemas          # regenerate from the Zod source
pnpm emit:schemas --check  # CI mode: exit 1 if the checked-in files drifted
```

On every test run, the checked-in schemas are (a) compared byte-for-byte
against a fresh emission and (b) validated with [ajv](https://ajv.js.org/)
against real fixtures, including negative cases.

## Published documents

| Document | Source of truth | Download |
| --- | --- | --- |
| Handoff v0.1 | `HandoffSchema` | [handoff-v0.1.json](/schemas/handoff-v0.1.json) |
| Config v0.1 | `ConfigSchema` | [config-v0.1.json](/schemas/config-v0.1.json) |
| Adapter event v0.1 | `AdapterEventSchema` | [adapter-event-v0.1.json](/schemas/adapter-event-v0.1.json) |

## Versioning

Schemas are versioned by file name (`*-v<major>.<minor>.json`) and carry an
`$id` on `baton.dev`. The v0.1 readers accept the legacy `threadline.dev`
`$id` during the rename transition. See the
[core spec](/guide/spec#7-canonical-handoff-schema) for the full evolution
policy.
