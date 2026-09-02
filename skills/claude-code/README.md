# Threadline for Claude Code

Copy `../threadline/SKILL.md` into your project (for example
`.claude/skills/threadline/SKILL.md`) so Claude Code can load it as a project
skill.

Make the CLI available to the session (choose one):

```bash
# Option A: run from the repo checkout
alias threadline="node /path/to/threadline/packages/cli/dist/main.js"

# Option B: global install from the monorepo
cd /path/to/threadline && npm install -g ./packages/cli
```

Optional hooks wrapper (Claude Code hooks): register a `PreCompact` hook that
runs `threadline detect --event '{"harness":"claude-code","signals":{"handoffRequest":true}}'`
so a draft is prepared before compaction. The command never terminates the
session; it only prints a recommendation.

Resume in a new session with the `/threadline-resume`-style command:
`threadline handoff list --status ready` then `threadline resume <id>`.
