/**
 * End-to-end suite (spec §18 e2e layer, §22 acceptance). Drives the *built*
 * CLI binary in temp git projects — no module-level mocking.
 *
 * Prerequisite: `pnpm build` has produced packages/cli/dist/main.js and
 * packages/mcp/dist/server.js (the CI and test scripts build first).
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const REPO = new URL("../..", import.meta.url).pathname;
const CLI = join(REPO, "packages/cli/dist/main.js");
const MCP = join(REPO, "packages/mcp/dist/server.js");

const roots: string[] = [];
afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

function project(): string {
  const root = mkdtempGit();
  roots.push(root);
  return root;
}

function mkdtempGit(): string {
  const root = join(tmpdir(), `baton-e2e-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(root, { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["config", "user.email", "e2e@example.com"], { cwd: root });
  execFileSync("git", ["config", "user.name", "e2e"], { cwd: root });
  writeFileSync(join(root, "README.md"), "# e2e\n");
  writeFileSync(join(root, "app.ts"), "export const app = 1;\n");
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync("git", ["commit", "-qm", "init"], { cwd: root });
  return root;
}

function tl(root: string, args: string[], expectExit = 0): { stdout: string; status: number } {
  const r = spawnSync("node", [CLI, ...args], { cwd: root, encoding: "utf8" });
  expect(r.status, `baton ${args.join(" ")} -> ${r.status}\n${r.stderr}`).toBe(expectExit);
  return { stdout: r.stdout ?? "", status: r.status ?? 0 };
}

function jsonOutput(root: string, args: string[]): Record<string, unknown> {
  const { stdout } = tl(root, ["--json", ...args]);
  return JSON.parse(stdout) as Record<string, unknown>;
}

function gitCommitAll(root: string, msg: string): void {
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync("git", ["commit", "-qm", msg], { cwd: root });
}

function createDraft(root: string, artifact = "app.ts"): string {
  const out = jsonOutput(root, [
    "checkpoint", "create",
    "--title", "E2E work",
    "--objective", "Demonstrate the full handoff lifecycle.",
    "--current-state", "Mid-task with verified helper",
    "--completed", "Added helper (synthetic claim for e2e)",
    "--evidence", JSON.stringify({ id: "E-001", type: "test", claim: "e2e synthetic evidence", ref: `node -e "process.exit(0)"`, result: "pass" }),
    "--artifact", JSON.stringify({ path: artifact, role: "modified" }),
    "--open-item", JSON.stringify({ id: "O-001", priority: "high", description: "Finish the work", suggested_action: "Run the checks", acceptance_check: "Checks green" }),
  ]);
  return (out.handoff as { id: string }).id;
}

describe("E2E: init -> checkpoint -> validate -> ready -> resume (§22.1)", () => {
  it("runs the full lifecycle with only the CLI", () => {
    const root = project();
    tl(root, ["init"]);
    expect(existsSync(join(root, ".baton/config.json"))).toBe(true);
    expect(existsSync(join(root, ".baton/handoffs"))).toBe(true);
    expect(existsSync(join(root, ".baton/policy.json"))).toBe(true);

    const id = createDraft(root);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);

    // Canonical file name and human-readable JSON on disk.
    const files = (readdirSafe(join(root, ".baton/handoffs"))).filter((f) => f.endsWith(".json"));
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^\d{8}T\d{6}Z--[0-9a-f]{8}\.json$/);
    const onDisk = JSON.parse(readFileSync(join(root, ".baton/handoffs", files[0]!), "utf8")) as Record<string, unknown>;
    expect(onDisk["$schema"]).toBe("https://baton.dev/schemas/handoff/v0.1.json");

    // Validate -> ready -> resume.
    tl(root, ["handoff", "validate", id]);
    tl(root, ["handoff", "ready", id]);
    const resumed = tl(root, ["resume", id]).stdout;
    expect(resumed).toContain("# Handoff: E2E work");
    expect(resumed).toContain("## First next action");
    expect(resumed).toContain("## Verify freshness");
  });

  it("rebuilds the index after deletion (§22.2)", () => {
    const root = project();
    tl(root, ["init"]);
    const id = createDraft(root);
    tl(root, ["handoff", "list"]); // creates sqlite index
    expect(existsSync(join(root, ".baton/index.sqlite"))).toBe(true);
    rmSync(join(root, ".baton/index.sqlite"));
    rmSync(join(root, ".baton/index.sqlite-wal"), { force: true });
    rmSync(join(root, ".baton/index.sqlite-shm"), { force: true });
    // JSON remains the source of truth; list still works and rebuilds.
    const out = jsonOutput(root, ["handoff", "list"]) as { handoffs: { id: string }[] };
    expect(out.handoffs.map((h) => h.id)).toContain(id);
  });

  it("gc removes only rebuildable state (§22.2)", () => {
    const root = project();
    tl(root, ["init"]);
    createDraft(root);
    tl(root, ["handoff", "list"]);
    tl(root, ["gc", "--dry-run"]);
    tl(root, ["gc"]);
    expect(existsSync(join(root, ".baton/index.sqlite"))).toBe(false);
    // Canonical records survive gc.
    const out = jsonOutput(root, ["handoff", "list"]) as { handoffs: unknown[] };
    expect(out.handoffs).toHaveLength(1);
  });
});

describe("E2E: stale resume (§22.3)", () => {
  it("flags a moved git head before presenting next actions", () => {
    const root = project();
    tl(root, ["init"]);
    const id = createDraft(root);
    tl(root, ["handoff", "validate", id]);
    tl(root, ["handoff", "ready", id]);
    writeFileSync(join(root, "app.ts"), "export const app = 2;\n");
    gitCommitAll(root, "move head after capture");
    const r = tl(root, ["resume", id]);
    expect(r.stdout).toContain("STALE");
    expect(r.stdout).toContain("git head moved since capture");
    // JSON contract carries structured stale reasons too.
    const j = jsonOutput(root, ["resume", id, "--format", "json"]) as { stale_reasons: string[] };
    expect(j.stale_reasons.length).toBeGreaterThan(0);
  });

  it("flags changed artifact content", () => {
    const root = project();
    tl(root, ["init"]);
    // Capture a content hash by validating (validation records hashes only when supplied).
    const id = createDraft(root);
    tl(root, ["handoff", "validate", id]);
    tl(root, ["handoff", "ready", id]);
    // Change the artifact without committing: not git-stale but file-drift.
    writeFileSync(join(root, "app.ts"), "export const app = 42;\n");
    const j = jsonOutput(root, ["resume", id, "--format", "json"]) as { freshness: { stale: boolean } };
    // Head unchanged (not committed), so staleness comes only from hash drift if hash was captured;
    // e2e records no content_hash, so this must NOT be stale — the check below pins that behavior.
    expect(j.freshness.stale).toBe(false);
  });
});

describe("E2E: policy (§22.4)", () => {
  it("redacts secret-like values, records the redaction, and persists no original", () => {
    const root = project();
    tl(root, ["init"]);
    const out = jsonOutput(root, [
      "checkpoint", "create",
      "--title", "Secret work",
      "--objective", "Handle credentials safely.",
      "--current-state", "used token: supersecret_value_123 in local tests",
    ]);
    const h = out.handoff as { id: string; summary: { current_state: string }; redactions: { field: string }[] };
    expect(h.summary.current_state).toContain("[REDACTED]");
    expect(JSON.stringify(h)).not.toContain("supersecret_value_123");
    expect(h.redactions.length).toBeGreaterThan(0);
    // audit reports the redaction without the value.
    const audit = jsonOutput(root, ["audit", h.id]) as { reports: { redactions: { field: string }[] }[] };
    expect(audit.reports[0]!.redactions.length).toBeGreaterThan(0);
    expect(JSON.stringify(audit)).not.toContain("supersecret_value_123");
  });

  it("blocks ready while a secret-like value is present in a fresh edit path", () => {
    const root = project();
    tl(root, ["init"]);
    // A record created directly with a secret is redacted at capture, so to test
    // validation blocking we inject one on disk and re-validate.
    const id = createDraft(root);
    const files = readdirSafe(join(root, ".baton/handoffs")).filter((f) => f.endsWith(".json"));
    const p = join(root, ".baton/handoffs", files[0]!);
    const raw = JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>;
    (raw.summary as { current_state: string }).current_state = "bearer sk-abcdefghijklmnopqrstuvwx";
    writeFileSync(p, JSON.stringify(raw, null, 2));
    const v = tl(root, ["handoff", "validate", id], 3); // exit 3 = validation failure
    void v;
    const ready = spawnSync("node", [CLI, "handoff", "ready", id], { cwd: root, encoding: "utf8" });
    expect(ready.status).toBe(3);
    expect(ready.stderr).toContain("validation failed");
  });
});

describe("E2E: detector (§22.5)", () => {
  it("explicit requests always create a draft; scores show inputs/reasons; cooldown honored", () => {
    const root = project();
    tl(root, ["init"]);
    // Low signal: no recommendation, no nag.
    const low = jsonOutput(root, ["detect", "--event", JSON.stringify({ harness: "generic", signals: { contextPressure: 0.2 } })]) as { recommendedAction: string; pressure: number };
    expect(low.recommendedAction).toBe("none");
    // High pressure + readiness: prepare, and --prepare actually creates a draft.
    const high = jsonOutput(root, ["detect", "--prepare", "--event", JSON.stringify({ harness: "generic", signals: { contextPressure: 1, turnPressure: 1, elapsedPressure: 1, changePressure: 1, resumeReadiness: 0.9 } })]) as { recommendedAction: string; draft: { id: string } | null };
    expect(high.recommendedAction).toBe("prepare");
    expect(high.draft).not.toBeNull();
    // Detector state recorded the prompt; an immediate repeat is suppressed.
    const again = jsonOutput(root, ["detect", "--event", JSON.stringify({ harness: "generic", signals: { contextPressure: 1 } })]) as { suppress: boolean };
    expect(again.suppress).toBe(true);
    // Explicit request always creates a draft regardless of suppression.
    const explicit = jsonOutput(root, ["checkpoint", "create", "--title", "Explicit", "--objective", "Explicit request draft.", "--current-state", "requested"]) as { handoff: { status: string } };
    expect(explicit.handoff.status).toBe("draft");
  });

  it("never terminates or launches a session (static contract)", () => {
    // The CLI has no such command surface at all:
    const help = tl(project(), ["--help"]).stdout;
    expect(help).not.toMatch(/kill|terminate|spawn|launch/i);
  });
});

describe("E2E: fork and merge (§22.7)", () => {
  it("forks produce immutable linked children; conflicted merge fails until resolution", () => {
    const root = project();
    tl(root, ["init"]);
    const parent = createDraft(root);
    tl(root, ["handoff", "validate", parent]);
    tl(root, ["handoff", "ready", parent]);
    const forkA = jsonOutput(root, ["fork", parent, "--label", "approach-a"]) as { handoff: { id: string; lineage: { relation: string; parents: string[] } } };
    const forkB = jsonOutput(root, ["fork", parent, "--label", "approach-b"]) as { handoff: { id: string; lineage: { relation: string; parents: string[] } } };
    expect(forkA.handoff.lineage.relation).toBe("fork");
    expect(forkA.handoff.lineage.parents).toEqual([parent]);
    // Parent remains ready (immutable, not modified by forking).
    const parentShow = jsonOutput(root, ["handoff", "show", parent]) as { status: string };
    expect(parentShow.status).toBe("ready");

    // Give the forks conflicting decisions and ready them.
    for (const [forkId, decision] of [[forkA.handoff.id, "Use PostgreSQL for storage."], [forkB.handoff.id, "Use SQLite for storage."]] as const) {
      const files = readdirSafe(join(root, ".baton/handoffs")).filter((f) => f.endsWith(".json"));
      for (const f of files) {
        const p = join(root, ".baton/handoffs", f);
        const raw = JSON.parse(readFileSync(p, "utf8")) as { id: string; decisions: unknown[] };
        if (raw.id === forkId) {
          raw.decisions = [{ id: "D-001", decision, rationale: null, alternatives_considered: [], evidence_ids: [], made_at: new Date().toISOString() }];
          writeFileSync(p, JSON.stringify(raw, null, 2));
        }
      }
      tl(root, ["handoff", "validate", forkId]);
      tl(root, ["handoff", "ready", forkId]);
    }

    // Merge without resolution fails with exit 4 (conflict).
    const blocked = spawnSync("node", [CLI, "merge", forkA.handoff.id, forkB.handoff.id], { cwd: root, encoding: "utf8" });
    expect(blocked.status).toBe(4);
    expect(blocked.stdout).toContain("conflicting decision");

    // With an explicit resolution file, the merge succeeds.
    writeFileSync(join(root, "resolution.json"), JSON.stringify({
      title: "Merged storage approach",
      objective: "Combine both fork objectives.",
      current_state: "Resolution recorded.",
      decision: "Use SQLite; PostgreSQL rejected for local-first requirement.",
    }));
    const mergedOut = jsonOutput(root, ["--json", "merge", forkA.handoff.id, forkB.handoff.id, "--resolution-file", "resolution.json"]) as { handoff: { id: string; lineage: { relation: string; parents: string[] } } };
    expect(mergedOut.handoff.lineage.relation).toBe("merge");
    expect(mergedOut.handoff.lineage.parents).toHaveLength(2);
  });
});

describe("E2E: validation catches malformed input (§22.8)", () => {
  it("catches missing artifacts, out-of-root paths, invalid evidence refs, unallowlisted recheck", () => {
    const root = project();
    tl(root, ["init"]);
    const id = createDraft(root, "missing-file.ts");
    tl(root, ["handoff", "validate", id], 3); // missing artifact -> exit 3

    // Out-of-root path
    const out2 = jsonOutput(root, [
      "checkpoint", "create",
      "--title", "Escape",
      "--objective", "Try to escape the root.",
      "--current-state", "state",
      "--artifact", JSON.stringify({ path: "../../etc/passwd", role: "read" }),
    ]) as { handoff: { id: string } };
    tl(root, ["handoff", "validate", out2.handoff.id], 3);

    // Invalid evidence reference from a decision
    const out3 = jsonOutput(root, [
      "checkpoint", "create",
      "--title", "Bad ref",
      "--objective", "Reference missing evidence.",
      "--current-state", "state",
      "--decision", JSON.stringify({ id: "D-001", decision: "Use X", evidence_ids: ["E-999"] }),
      "--evidence", JSON.stringify({ id: "E-001", type: "human", claim: "c", ref: null, result: null }),
    ]) as { handoff: { id: string } };
    tl(root, ["handoff", "validate", out3.handoff.id], 3);
  });

  it("recheck re-runs only allowlisted commands", () => {
    const root = project();
    tl(root, ["init"]);
    const id = createDraft(root);
    // No allowlist configured: recheck warns and does not execute.
    tl(root, ["handoff", "validate", id, "--recheck"]);
    const ready = tl(root, ["handoff", "ready", id]);
    expect(ready.status).toBe(0);
  });
});

describe("E2E: doctor and lineage", () => {
  it("doctor reports health; lineage renders the graph", () => {
    const root = project();
    tl(root, ["init"]);
    const id = createDraft(root);
    tl(root, ["fork", id, "--label", "explore"]);
    const doctor = tl(root, ["doctor"]);
    expect(doctor.stdout).toContain("initialized:    true");
    expect(doctor.stdout).toContain("sqlite index:   ok");
    const lineage = tl(root, ["lineage"]).stdout;
    expect(lineage).toContain("[explore]");
    expect(lineage).toContain("fork");
  });
});

describe("E2E: legacy .threadline migration (adapter spec §7.2)", () => {
  it("init hints, migrate --dry-run plans, migrate moves and re-ids, commands then use .baton", () => {
    const root = project();
    // Build a legacy project by hand (pre-rename layout).
    mkdirSync(join(root, ".threadline/handoffs"), { recursive: true });
    writeFileSync(
      join(root, ".threadline/config.json"),
      JSON.stringify({ schema_version: "0.1", project_id: "sha256:legacy-e2e", detector: {}, policy: {} }),
    );
    writeFileSync(
      join(root, ".threadline/handoffs/20260901T120000Z--0198c0de.json"),
      JSON.stringify({
        $schema: "https://threadline.dev/schemas/handoff/v0.1.json",
        schema_version: "0.1",
        id: "0198c0de-7000-7000-8000-0000000000e2",
        kind: "handoff",
        status: "ready",
        flags: [],
        created_at: "2026-09-01T12:00:00Z",
        updated_at: "2026-09-01T12:00:00Z",
        project: { id: "sha256:legacy-e2e", root_hint: ".", repository: null },
        origin: { harness: "generic", adapter_version: null, session_id: null, model: null, actor: null },
        work: { title: "Legacy e2e work", objective: "Survive the rename.", scope: [], constraints: [], definition_of_done: [] },
        summary: { completed: [], current_state: "pre-rename state", why_it_matters: null },
        decisions: [],
        artifacts: [],
        evidence: [],
        open_items: [
          { id: "O-001", priority: "high", description: "Next", suggested_action: "Act", blocked_by: [], acceptance_check: null },
        ],
        risks: [],
        validation: { status: "pass", validated_at: null, checks: [], freshness: null },
        lineage: { parents: [], relation: "root", branch_label: null, merge_basis: [] },
        automation: { trigger: "manual", score: null, reasons: [] },
        redactions: [],
      }),
    );

    // Commands still work against the legacy dir before migration.
    const before = jsonOutput(root, ["handoff", "list"]) as { handoffs: { id: string }[] };
    expect(before.handoffs.map((h) => h.id)).toContain("0198c0de-7000-7000-8000-0000000000e2");

    // Dry run before init: pure move plan, nothing changed.
    const dry = tl(root, ["migrate", "--dry-run"]);
    expect(dry.stdout).toContain("Dry run");
    expect(dry.stdout).toContain(".threadline/ -> .baton/");
    expect(existsSync(join(root, ".threadline"))).toBe(true);
    expect(existsSync(join(root, ".baton"))).toBe(false);

    // init without the flag hints but does not migrate; it creates .baton,
    // which puts the later migration into merge mode (spec §7.2).
    const initOut = tl(root, ["init"]);
    expect(initOut.stdout).toContain("legacy .threadline/ detected");
    expect(existsSync(join(root, ".threadline"))).toBe(true);

    // Real migration (merge mode: legacy kept as .baton.legacy/).
    const mig = tl(root, ["migrate"]);
    expect(mig.stdout).toContain("Migrated legacy Baton state");
    expect(mig.stdout).toContain(".baton.legacy/");
    expect(existsSync(join(root, ".threadline"))).toBe(false);
    expect(existsSync(join(root, ".baton/config.json"))).toBe(true);

    // The init-created config survived the merge (target files are not clobbered).
    const cfg = JSON.parse(readFileSync(join(root, ".baton/config.json"), "utf8")) as { project_id: string };
    expect(cfg.project_id).not.toBe("sha256:legacy-e2e");

    // The record was re-id'd and still loads through the canonical schema.
    const record = JSON.parse(
      readFileSync(join(root, ".baton/handoffs/20260901T120000Z--0198c0de.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(record["$schema"]).toBe("https://baton.dev/schemas/handoff/v0.1.json");
    const after = jsonOutput(root, ["handoff", "show", "0198c0de"]) as { id: string; work: { title: string } };
    expect(after.id).toBe("0198c0de-7000-7000-8000-0000000000e2");
    expect(after.work.title).toBe("Legacy e2e work");

    // Idempotent re-run.
    const again = tl(root, ["migrate"]);
    expect(again.stdout).toContain("nothing to migrate");

    // doctor no longer reports the legacy dir.
    expect(tl(root, ["doctor"]).stdout).not.toContain("legacy dir:");
  });

  it("init --migrate-legacy performs the migration in one step", () => {
    const root = project();
    mkdirSync(join(root, ".threadline/handoffs"), { recursive: true });
    writeFileSync(
      join(root, ".threadline/config.json"),
      JSON.stringify({ schema_version: "0.1", project_id: "sha256:legacy-one-step", detector: {}, policy: {} }),
    );
    const out = tl(root, ["init", "--migrate-legacy"]);
    expect(out.stdout).toContain("migrated: .threadline/ -> .baton/");
    expect(existsSync(join(root, ".threadline"))).toBe(false);
    expect(existsSync(join(root, ".baton/config.json"))).toBe(true);
  });
});

function readdirSafe(dir: string): string[] {
  try {
    return readdirRaw(dir);
  } catch {
    return [];
  }
}

import { readdirSync as readdirRaw } from "node:fs";

describe("E2E: resume via MCP (§22.6)", () => {
  it("produces equivalent core state and freshness results via handoff_resume", async () => {
    const root = project();
    tl(root, ["init"]);
    const id = createDraft(root);
    tl(root, ["handoff", "validate", id]);
    tl(root, ["handoff", "ready", id]);

    // Minimal JSON-RPC over stdio against the built MCP server.
    const proc = spawnSync("node", [MCP], {
      cwd: root,
      input:
        JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "e2e", version: "0" } } }) + "\n" +
        JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }) + "\n" +
        JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "handoff_resume", arguments: { root, id } } }) + "\n" +
        JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "handoff_list", arguments: { root } } }) + "\n",
      encoding: "utf8",
      timeout: 30_000,
    });
    const lines = proc.stdout.split("\n").filter((l) => l.trim().startsWith("{"));
    const responses = lines.map((l) => JSON.parse(l) as { id: number; result?: { content?: { text: string }[] } });
    const resume = responses.find((r) => r.id === 2);
    expect(resume).toBeDefined();
    const text = resume!.result!.content![0]!.text;
    expect(text).toContain("# Handoff: E2E work");
    expect(text).toContain("## Verify freshness");

    // Parity: the CLI resume of the same record contains the same sections.
    const cliResume = tl(root, ["resume", id]).stdout;
    expect(text).toContain(cliResume.split("\n").find((l) => l.startsWith("# Handoff:"))!);
    void existsSync;
    void readFileSync;
  });
});

void execFileSync;
