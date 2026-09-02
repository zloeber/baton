# Baton for Claude Code

Copy `../baton/SKILL.md` into your project (for example
`.claude/skills/baton/SKILL.md`) so Claude Code can load it as a project
skill.

Make the CLI available to the session (choose one):

```bash
# Option A: run from the repo checkout
alias baton="node /path/to/baton/packages/cli/dist/main.js"

# Option B: global install from the monorepo
cd /path/to/baton && npm install -g ./packages/cli
```

Optional hooks wrapper (Claude Code hooks): register a `PreCompact` hook that
runs `baton detect --event '{"harness":"claude-code","signals":{"handoffRequest":true}}'`
so a draft is prepared before compaction. The command never terminates the
session; it only prints a recommendation.

Resume in a new session with the `/baton-resume`-style command:
`baton handoff list --status ready` then `baton resume <id>`.
