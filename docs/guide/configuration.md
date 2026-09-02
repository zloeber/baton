# Configuration

All configuration lives inside the project:

```text
.baton/
  config.json     # shareable defaults (commit-safe)
  local.json      # machine-specific override (gitignored)
  policy.json     # starter ignore policy for capture
  handoffs/       # canonical records (commit or gitignore — your choice)
  cache/          # gitignored; rebuildable
  index.sqlite    # gitignored; rebuildable
```

## config.json

```json
{
  "schema_version": "0.1",
  "project_id": "sha256:…",
  "detector": {
    "weights": {
      "explicitRequest": 1.0,
      "contextPressure": 0.7,
      "turnPressure": 0.15,
      "elapsedPressure": 0.1,
      "changePressure": 0.05,
      "stuckSignal": 0.6,
      "workBoundary": 0.25
    },
    "recommendThreshold": 0.7,
    "autoPrepareThreshold": 0.85,
    "readinessThreshold": 0.8,
    "promptCooldownMinutes": 20
  },
  "policy": {
    "secretPatterns": ["…regex strings…"],
    "sensitiveFilePatterns": ["\\.env(\\.|$)", "…"],
    "allowedRoots": [],
    "hashSessionIds": true
  }
}
```

Detector semantics (spec §9.2):

```
pressure = max(
  1.00 * explicit_request,
  0.70*context + 0.15*turn + 0.10*elapsed + 0.05*change,
  0.60*stuck  + 0.25*boundary + 0.15*change
)
recommend     = pressure >= recommendThreshold
auto_prepare  = pressure >= autoPrepareThreshold AND readiness >= readinessThreshold
```

`null` signals are excluded from their term rather than treated as zero; the
detector output lists which inputs were used. Prompt suppression lasts
`promptCooldownMinutes` or until a material change (score jump ≥ 0.15 or an
explicit request).

## local.json

Any top-level key here overrides `config.json` (deep-merged for `detector`
and `policy`). Keep machine-specific paths and personal policy tweaks here;
`local.json` is gitignored by the repository's `.gitignore`.

## Recheck allowlist

Add a top-level `recheckAllowlist: ["npm test --", "pnpm exec vitest run"]`
array to `config.json` (or `local.json`). `handoff validate --recheck` re-runs
only evidence whose `ref` starts with an allowlisted prefix. Commands never
run without the flag.

## Logging

Local JSONL logging is disabled by default. Set `BATON_LOG=info|debug`
to enable. Logs contain record ids and event names only — never handoff body
values, command output, or secrets.
