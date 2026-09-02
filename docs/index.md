---
layout: home

hero:
  name: "Baton"
  text: "Handoffs your agent can put down and pick back up."
  tagline: Portable, validated, local-first context handoffs for coding agents. Capture a checkpoint mid-task, validate it against the policy you chose, and resume later — in the same harness or a different one.
  actions:
    - theme: brand
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: What is Baton?
      link: /guide/what-is-baton

features:
  - icon: 🏏
    title: Capturable checkpoints
    details: One command captures work-in-progress, decisions, evidence, and next steps into a versioned, on-disk handoff document.
  - icon: ✅
    title: Validation before readiness
    details: Policy-driven validation gates — no handoff becomes "ready" until completeness, lineage, and consistency checks pass.
  - icon: 🔒
    title: Local-first by construction
    details: Everything lives in .baton/ in your project. No cloud, no telemetry by default, secrets redacted at capture time.
  - icon: 🔌
    title: Harness-agnostic
    details: A generic adapter plus an MCP server and a Hermes context-engine plugin. Same schema, same behavior, everywhere.
  - icon: 📜
    title: Schema-driven
    details: JSON Schemas are generated artifacts from a single Zod source of truth, validated against real fixtures on every test run.
  - icon: 🧭
    title: Resumable anywhere
    details: The ≤1,200-token resume brief renders to Markdown or JSON and is designed to be pasted into any agent's context.
---
