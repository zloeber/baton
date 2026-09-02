# Security and privacy

## Scope

- Default scope is the **current project root**. Artifact and file-evidence
  paths are rejected when they escape root (`policy.paths` validation check,
  exit code 3). Additional roots may be trusted explicitly via
  `.baton/config.json` → `policy.allowedRoots`.
- Baton never reads or serializes environment variables, credentials,
  `.env` contents, auth headers, private prompts, clipboard contents, or full
  conversation transcripts.

## Transcript policy

No transcript-bearing field (`transcript`, `messages`, `conversation`,
`chat_history`, `full_transcript`, `turns`) is accepted anywhere in a record in
v0.1. Validation fails with `policy.transcript` if one appears — including via
forward-compatible passthrough fields.

## Redaction

Before any write, values matching configured `policy.secretPatterns` are
replaced with `[REDACTED]` and the change is **recorded by field path and
reason only** — the removed value is never persisted anywhere. Defaults cover
common API-key assignments, PEM blocks, AWS/GitHub/OpenAI key formats, and
credential headers.

Validation is stricter than capture: a secret-like value that reaches a record
without redaction fails `policy.secrets`, and `handoff ready` refuses to
promote (exit 3).

Evidence output is treated as potentially sensitive: store a digest plus a
bounded summary by default, never raw command output. Command evidence is
never re-run by `validate` unless `--recheck` is passed **and** the command
matches the configured recheck allowlist.

## Identifiers

Externally supplied session ids are hashed to opaque `s-<16 hex>` tokens by
default (`policy.hashSessionIds`). Records never contain raw identifiers.

## Network

The MVP performs no network calls, telemetry, or cloud sync. Any future sync
must be opt-in, encrypted in transit, project-selective, and reuse this same
redaction pipeline.

## Deletion and audit

`baton audit [id]` enumerates per record: field counts, redactions,
external refs, local paths, and transcript-field scan results.
`baton gc` removes only the rebuildable SQLite index and cache; canonical
records are never removed automatically. Record-level deletion is
user-directed (`audit` identifies candidates; removal is a manual, explicit
step on the JSON file).
