# Config — v0.1

The `.baton/config.json` document: detector tuning, policy toggles, and
redaction rules. See [Configuration](/guide/configuration) for the
user-facing behavior.

- **$id:** `https://baton.dev/schemas/config-v0.1.json`
- **Source of truth:** `ConfigSchema` in `packages/core/src/projectInit.ts`
- **Download:** [config-v0.1.json](/schemas/config-v0.1.json)

Defaults are intentional: the detector only *suggests* (it never blocks),
and every policy check can be disabled in config.

<schema-viewer schema="/schemas/config-v0.1.json" />
