# Baton for Codex CLI

Add the skill content from `../baton/SKILL.md` to your project
instructions, and register the MCP server so the agent can call the tools:

```json
{
  "mcpServers": {
    "baton": {
      "command": "node",
      "args": ["/path/to/baton/packages/mcp/dist/server.js"]
    }
  }
}
```

Then `handoff_resume`, `handoff_capture`, and friends are available as MCP
tools scoped to the project root argument.

CLI-only alternative: install the CLI and let the agent run
`baton handoff list --status ready` and `baton resume <id>` at
session start.
