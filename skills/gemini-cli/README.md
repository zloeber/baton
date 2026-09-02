# Threadline for Gemini CLI

Install the CLI and add the skill content from `../threadline/SKILL.md` as a
project command/extension instruction. If your Gemini CLI version supports
MCP, register the server:

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

Otherwise use the terminal commands:

```bash
threadline handoff list --status ready
threadline resume <id>
```
