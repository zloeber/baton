# Adapter event — v0.1

The event accepted by `baton detect --event` and the MCP `handoff_detect`
tool: harness identity plus optional signals and material events.

- **$id:** `https://baton.dev/schemas/adapter-event-v0.1.json`
- **Source of truth:** `AdapterEventSchema` in `packages/core/src/detect/index.ts`
- **Download:** [adapter-event-v0.1.json](/schemas/adapter-event-v0.1.json)

`passthrough` posture: harnesses may attach extra fields (trace ids, harness
versions) and they survive round-trips.

<schema-viewer schema="/schemas/adapter-event-v0.1.json" />
