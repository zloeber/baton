# Threadline for Cursor

Add `../threadline/SKILL.md` as a project rule (`.cursor/rules/threadline.md`)
and use the CLI from Cursor's terminal:

```bash
threadline handoff list --status ready
threadline resume <id> --format prompt
```

Paste the rendered resume brief at the start of a new chat. Avoid relying on
undocumented context metrics; trigger handoffs explicitly with
`threadline checkpoint create ...` / `threadline handoff prepare`.
