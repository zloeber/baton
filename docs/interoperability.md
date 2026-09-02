# Interoperability

The universal integration is a **shell command plus a Markdown skill**. All
integrations are optional and thin; vendor-specific code lives in separate
packages and is tested with recorded fixtures, so core schema evolution never
depends on a vendor release.

## The adapter contract

Adapters implement `ThreadlineAdapter` from `@threadline/adapter-sdk`:

```ts
interface ThreadlineAdapter {
  getProjectContext(): Promise<ProjectContext>;        // root, id, initialized
  getSessionMetadata(): Promise<SessionMetadata>;      // harness, opaque id, model
  subscribeEvents?(handler: (event: AdapterEvent) => void): () => void;
  renderNotice?(input: RenderNoticeInput): void;
}
```

Rules:

- No adapter may require raw messages or hidden prompts.
- `AdapterEvent` carries only normalized 0–1 signals plus the harness name and
  an optional opaque session id.
- Evaluate events with `evaluateEvent(event, config, lastPromptAt,
  previousPressure)` from `@threadline/core`, or shell out to
  `threadline detect --event '<json>'` for identical semantics, cooldown
  handling, and JSON contract.
- Automation **recommends and prepares**; it never terminates a session or
  launches another agent.

## Environment matrix (spec §15)

| Environment | MVP integration | Automation signal | Resume path |
|---|---|---|---|
| Claude Code | Project skill; optional `PreCompact` hook | explicit command; hook event | `/threadline-resume`-style command or `threadline resume` |
| Codex | Project instructions + MCP config | explicit command; session boundary | MCP `handoff_resume` or CLI brief |
| Cursor | Project rule + terminal task | explicit action; user-triggered new chat | paste rendered resume brief |
| Gemini CLI | Project command/extension; MCP if supported | explicit command; lifecycle hook if stable | CLI or MCP resume |
| Open-source harnesses | npm package + CLI; documented event adapter | normalized `detect --event` JSON | CLI/MCP |

## Event format

```json
{
  "harness": "your-harness",
  "session_id": "opaque-or-null",
  "material_event": "pre_compaction",
  "signals": {
    "contextPressure": 0.92,
    "turnPressure": 0.6,
    "elapsedPressure": null,
    "workBoundary": false,
    "handoffRequest": false,
    "changePressure": 0.4,
    "stuckSignal": null,
    "resumeReadiness": 0.9
  }
}
```

Unavailable signals are `null`, never guessed. The detector's output includes
the inputs actually used and human-readable reasons, so every recommendation
is auditable. See `examples/adapter-events/events.json` for fixtures.
