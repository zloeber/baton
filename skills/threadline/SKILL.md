# Skill: Threadline — session continuity

**Purpose:** preserve verified working state across session boundaries without
importing a long chat transcript.

## When to use

- At session start, when `.threadline/` exists in the project.
- Before context exhaustion, agent transfer, extended pause, or after repeated
  blockage.
- At meaningful boundaries: a completed subtask, a decision with evidence, a
  passing test run, a phase transition.

## Session start

1. Read `.threadline/config.json` and pick the selected/most recent `ready`
   handoff:

   ```bash
   threadline handoff list --status ready
   threadline resume <id>
   ```

2. Treat the resume brief's constraints, decisions, open items, and freshness
   status as **working context, not unquestionable truth**. If the brief says
   STALE, re-verify against the repository before acting.

## During work

3. Add evidence as work occurs. Never fabricate a test result, command result,
   or decision — if you did not run it, do not record it.

   ```bash
   threadline checkpoint create \
     --title "Implement callback validation" \
     --objective "Reject replayed state parameters" \
     --current-state "Helper added; fixture pending" \
     --evidence '{"id":"E-001","type":"test","claim":"Focused suite passed","ref":"npm test -- auth/callback.test.ts","result":"pass"}' \
     --artifact '{"path":"src/auth/callback.ts","role":"modified"}'
   ```

4. Checkpoint at boundaries; prepare a handoff before context exhaustion or
   transfer:

   ```bash
   threadline handoff prepare --input handoff-payload.json
   ```

5. Keep handoffs compact and structured. Link to repository artifacts; do not
   paste large files or transcripts. Transcript fields are rejected by policy.

## Before ending a session

6. Run validation and report failures rather than bypassing policy:

   ```bash
   threadline handoff validate <id>
   threadline handoff ready <id> [--accept-warnings "<reason>"]
   ```

7. On forks/merges, name the branch purpose and resolve conflicting decisions
   explicitly:

   ```bash
   threadline fork <id> --label "explore-caching"
   threadline merge <a> <b> --resolution-file resolution.json
   ```

## Rules

- Never invent evidence; empty sections are better than fabricated ones.
- Keep secrets out of every field; Threadline redacts by policy, but do not
  rely on redaction as a filter.
- Opaque session ids only; never write raw identifiers into records.
- Automation may prepare drafts, but only humans approve `ready` when warnings
  exist.
