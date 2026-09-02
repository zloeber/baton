# Threadline for Codex CLI

Add the skill content from `../threadline/SKILL.md` to your project
instructions, and register the MCP server so the agent can call the tools:

```json
{
  "mcpServers": {
    "threadline": {
      "command": "node",
      "args": ["/path/to/threadline/packages/mcp/dist/server.js"]
    }
  }
}
```

Then `handoff_resume`, `handoff_capture`, and friends are available as MCP
tools scoped to the project root argument.

CLI-only alternative: install the CLI and let the agent run
`threadline handoff list --status ready` and `threadline resume <id>` at
session start.
