# Hermes adapter

Baton ships as a [Hermes agent](https://github.com/dqfront/NousResearch-hermes-agent)
**context engine plugin**: a single-select provider that replaces Hermes'
built-in context compressor with Baton's capture → validate → persist →
render cycle. When compaction would occur, Baton instead produces a
validated, on-disk handoff and a ≤1,200-token resume brief.

The normative document for this adapter is the
[Hermes adapter spec](./hermes-adapter-spec); this page is the practical
guide.

## Installation

Copy or symlink the plugin directory into Hermes' plugin search path:

```bash
ln -s /path/to/baton/plugins/context_engine/baton \
      /path/to/hermes/plugins/context_engine/baton
```

## Activation

Context engines are single-select. In your Hermes config:

```yaml
context:
  engine: baton
```

Until this is set, Hermes keeps its built-in compressor — the plugin is
inert otherwise.

## Prerequisites

The plugin is a thin Python bridge over the Baton CLI:

```bash
export BATON_CLI=/path/to/baton/packages/cli/dist/main.js
# or a globally installed binary:
# export BATON_CLI=$(which baton)
```

A `.js` CLI path is fine — the bridge prefixes `node` automatically.

## What happens on compaction

When Hermes' engine loop calls `should_compress` and then `compress`, the
Baton engine:

1. Scores the session's signals (context pressure, turn pressure) with the
   same deterministic detector the CLI uses — auditable, with reasons.
2. Captures a checkpoint with trigger `pre_compaction`.
3. Runs the full policy engine; a passing draft is persisted.
4. Returns a synthetic message list containing the resume brief plus a
   provenance banner (handoff id, created-at, project).
5. If validation **fails**, the engine degrades gracefully: recent messages
   are retained with an explanatory note. A context engine must never
   throw or silently drop context.

## Engine tools

The engine exposes three tools through Hermes' engine-tool mechanism:

| Tool | Purpose |
| --- | --- |
| `baton_capture` | Capture a checkpoint on demand |
| `baton_resume` | Fetch the current resume brief |
| `baton_status` | Detector scores, session state, last handoff |

## Configuration

| Environment variable | Default | Purpose |
| --- | --- | --- |
| `BATON_CLI` | `baton` on PATH | CLI entrypoint the bridge spawns |
| `BATON_TIMEOUT_MS` | `15000` | Subprocess timeout |
| `BATON_FAIL_SOFT` | `1` | Degrade instead of raising on CLI errors |

## Testing

The bridge has a hermetic contract suite (fake CLI subprocess) and a
real-CLI parity suite:

```bash
mise run test:py    # or: python3 -m pytest tests/python
```
