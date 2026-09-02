# Baton for Gemini CLI

Install the CLI and add the skill content from `../baton/SKILL.md` as a
project command/extension instruction. If your Gemini CLI version supports
MCP, register the server:

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

Otherwise use the terminal commands:

```bash
baton handoff list --status ready
baton resume <id>
```
