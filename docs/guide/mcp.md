# MCP server

Baton ships a Model Context Protocol server (`@baton/mcp`) that exposes the
core operations as MCP tools over stdio, so any MCP-capable harness can
capture, validate, and resume handoffs without shelling out to the CLI.

## Running it

```bash
baton-mcp
```

or directly from a checkout:

```bash
node packages/mcp/dist/server.js
```

The server is stateless per connection and operates on the project at the
current working directory (resolved the same way the CLI resolves it).

## Tools

| Tool | Purpose |
| --- | --- |
| `handoff_init` | Initialize `.baton/` for a project |
| `handoff_capture` | Create a draft handoff from structured fields |
| `handoff_validate` | Run the policy engine, return per-check results |
| `handoff_ready` | Promote a validated draft to `ready` |
| `handoff_resume` | Render the resume brief |
| `handoff_list` | List handoffs |
| `handoff_detect` | Feed adapter events / signals, get a suggestion |
| `handoff_status` | Project + session status snapshot |
| `handoff_metrics` | Event log summary |

Tool results follow the same policy semantics as the CLI: a failed
validation is a structured policy-error result (never a thrown exception),
so agents can branch on the payload.

## Parity

The MCP layer is a thin translation layer over `@baton/core` — the same
functions the CLI calls. Contract tests in `packages/mcp/tests/` assert
that tool results match CLI behavior for the same inputs.
