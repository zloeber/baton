# Baton for Cursor

Add `../baton/SKILL.md` as a project rule (`.cursor/rules/baton.md`)
and use the CLI from Cursor's terminal:

```bash
baton handoff list --status ready
baton resume <id> --format prompt
```

Paste the rendered resume brief at the start of a new chat. Avoid relying on
undocumented context metrics; trigger handoffs explicitly with
`baton checkpoint create ...` / `baton handoff prepare`.
