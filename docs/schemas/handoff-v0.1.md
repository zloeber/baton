# Handoff — v0.1

The canonical handoff document: what the agent knew, decided, and must do
next. Normative rules live in the [core spec](/guide/spec#7-canonical-handoff-schema).

- **$id:** `https://baton.dev/schemas/handoff/v0.1.json`
- **Source of truth:** `HandoffSchema` in `packages/core/src/schema.ts`
- **Download:** [handoff-v0.1.json](/schemas/handoff-v0.1.json)

Notable constraints:

- `schema_version` is pinned to `"0.1"` in v0.1.
- `id` is a UUIDv7; `project.id` is `sha256:<hex>` or `slug:<kebab>`.
- Object shapes are `passthrough`: unknown fields round-trip.
- No transcript field exists in v0.1; policy rejects any added one.

<schema-viewer schema="/schemas/handoff-v0.1.json" />
