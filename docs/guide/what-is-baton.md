# What is Baton?

Baton is a **context-handoff toolkit for coding agents**. When an agent session
ends — context window exhausted, task interrupted, harness switched — the
expensive part is rarely the code; it's the *understanding*. Which decisions
were made and why, what evidence backs them, what remains.

Baton captures that understanding as a **handoff**: a versioned, validated,
on-disk document under `.baton/` in your project. No cloud service, no hidden
state — just files you can read, diff, and commit.

## The lifecycle

```
detect ──▶ capture (draft) ──▶ validate ──▶ ready ──▶ resume
   ▲                                                    │
   └────────────────────  new session  ◀────────────────┘
```

1. **Detect** — signal collectors (context pressure, turn pressure, resume
   readiness) feed a deterministic scoring model that suggests *when* to
   capture. Harnesses can also emit explicit material events.
2. **Capture** — `baton checkpoint` writes a `draft` handoff: objective,
   current state, next steps, decisions with evidence, open questions.
3. **Validate** — policy checks (completeness, lineage conflicts, structured
   ID validity, redaction) run against the draft. Failures are precise and
   actionable.
4. **Ready** — a draft that passes validation is promoted to `ready`. Only
   ready handoffs are resumable.
5. **Resume** — `baton resume` renders the ≤1,200-token resume brief
   (Markdown or JSON) to seed a fresh session.

## Design principles

- **Local-first.** All state lives in the project. Deleting `.baton/`
  uninstalls everything Baton knows about your project.
- **Validated, not vibes.** Every persisted handoff has passed the same
  policy engine, and every schema in the repository is generated from one
  Zod source of truth and tested against real fixtures.
- **Harness-agnostic.** The core is a TypeScript library; the CLI, the MCP
  server, and the Hermes context-engine plugin are thin surfaces over it.
  One implementation, no drift.
- **Forward compatible.** Handoff objects are `passthrough`: unknown fields
  survive a read/write cycle so older tools never destroy newer data.

## Where to go next

- [Getting started](./getting-started) — install and run the five-minute flow.
- [CLI reference](./cli) — every command and flag.
- [Hermes adapter](./hermes-adapter) — replace Hermes' built-in compressor
  with Baton.
- [Core spec](./spec) — the canonical normative document.
