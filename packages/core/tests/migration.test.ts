import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CURRENT_SCHEMA_ID,
  LEGACY_SCHEMA_ID,
  detectLegacyProject,
  migrateLegacyProject,
  planLegacyMigration,
} from "../src/migration.js";
import { initProject, loadConfig, resolveBatonDirName } from "../src/projectInit.js";
import { ProjectStore } from "../src/projectStore.js";

let root: string;
beforeEach(() => {
  root = join(tmpdir(), `baton-mig-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(root, { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function makeLegacyProject(): string {
  const legacy = join(root, ".threadline");
  mkdirSync(join(legacy, "handoffs"), { recursive: true });
  writeFileSync(
    join(legacy, "config.json"),
    JSON.stringify({ schema_version: "0.1", project_id: "sha256:legacy", detector: {}, policy: {} }),
  );
  writeFileSync(join(legacy, "policy.json"), JSON.stringify({ ignore: [] }));
  writeFileSync(
    join(legacy, "handoffs", "20260901T120000Z--0198c0de.json"),
    JSON.stringify(fixtureHandoff(LEGACY_SCHEMA_ID)),
  );
  return legacy;
}

function fixtureHandoff(schemaId: string): Record<string, unknown> {
  return {
    $schema: schemaId,
    schema_version: "0.1",
    id: "0198c0de-7000-7000-8000-000000000009",
    kind: "handoff",
    status: "ready",
    flags: [],
    created_at: "2026-09-01T12:00:00Z",
    updated_at: "2026-09-01T12:00:00Z",
    project: { id: "sha256:x", root_hint: ".", repository: null },
    origin: { harness: "generic", adapter_version: null, session_id: null, model: null, actor: null },
    work: { title: "Legacy work", objective: "Carried over.", scope: [], constraints: [], definition_of_done: [] },
    summary: { completed: [], current_state: "state", why_it_matters: null },
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
    vendor_extension: { keep: true },
  };
}

describe("detectLegacyProject", () => {
  it("detects a legacy dir and nothing after migration", () => {
    expect(detectLegacyProject(root)).toBe(false);
    makeLegacyProject();
    expect(detectLegacyProject(root)).toBe(true);
    migrateLegacyProject(root);
    expect(detectLegacyProject(root)).toBe(false);
  });
});

describe("planLegacyMigration (dry run)", () => {
  it("describes the move and the records to rewrite without touching disk", () => {
    makeLegacyProject();
    const plan = planLegacyMigration(root);
    expect(plan.items[0]).toMatchObject({ source: ".threadline", destination: ".baton", action: "move-dir" });
    expect(plan.handoffs_to_rewrite).toEqual(["20260901T120000Z--0198c0de.json"]);
    expect(plan.would_remove_legacy).toBe(true);
    expect(plan.warnings).toEqual([]);
    // Dry run must not change anything.
    expect(existsSync(join(root, ".threadline"))).toBe(true);
    expect(existsSync(join(root, ".baton"))).toBe(false);
  });

  it("warns when the target dir already exists (merge mode)", () => {
    makeLegacyProject();
    initProject(root); // creates .baton
    const plan = planLegacyMigration(root);
    expect(plan.warnings.join(" ")).toContain(".baton/ already exists");
    expect(plan.items[0]!.destination).toBe(".baton.legacy");
    expect(plan.would_remove_legacy).toBe(false);
  });

  it("is a no-op plan without a legacy dir", () => {
    const plan = planLegacyMigration(root);
    expect(plan.items).toEqual([]);
    expect(plan.warnings.join(" ")).toContain("does not exist");
  });
});

describe("migrateLegacyProject", () => {
  it("moves the dir, rewrites $schema, preserves unknown fields and records", () => {
    makeLegacyProject();
    const result = migrateLegacyProject(root);
    expect(result.migrated).toBe(true);
    expect(result.backup_dir).toBeNull();
    expect(existsSync(join(root, ".threadline"))).toBe(false);
    expect(existsSync(join(root, ".baton/config.json"))).toBe(true);
    const record = JSON.parse(
      readFileSync(join(root, ".baton/handoffs/20260901T120000Z--0198c0de.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(record["$schema"]).toBe(CURRENT_SCHEMA_ID);
    expect(record["vendor_extension"]).toEqual({ keep: true }); // forward-compat preserved
    // The migrated record parses through the canonical schema.
    const store = new ProjectStore(root);
    expect(store.loadOrThrow("0198c0de-7000-7000-8000-000000000009").work.title).toBe("Legacy work");
  });

  it("rewrites only legacy schema ids", () => {
    makeLegacyProject();
    writeFileSync(
      join(root, ".threadline/handoffs/20260901T130000Z--0198c0df.json"),
      JSON.stringify(fixtureHandoff(CURRENT_SCHEMA_ID)),
    );
    const result = migrateLegacyProject(root);
    expect(result.rewritten).toEqual(["20260901T120000Z--0198c0de.json"]);
  });

  it("merges into an existing .baton dir, backing up legacy instead of removing", () => {
    makeLegacyProject();
    initProject(root);
    writeFileSync(join(root, ".baton/config.json"), JSON.stringify({ schema_version: "0.1", project_id: "sha256:new", detector: {}, policy: {} }));
    const result = migrateLegacyProject(root);
    expect(result.migrated).toBe(true);
    expect(result.backup_dir).toBe(join(root, ".baton.legacy"));
    // Target config untouched by the merge.
    expect(loadConfig(root).project_id).toBe("sha256:new");
    // Legacy record landed in .baton/handoffs and was rewritten.
    expect(existsSync(join(root, ".baton/handoffs/20260901T120000Z--0198c0de.json"))).toBe(true);
    const record = JSON.parse(
      readFileSync(join(root, ".baton/handoffs/20260901T120000Z--0198c0de.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(record["$schema"]).toBe(CURRENT_SCHEMA_ID);
    expect(existsSync(join(root, ".baton.legacy"))).toBe(true);
  });

  it("is idempotent", () => {
    makeLegacyProject();
    migrateLegacyProject(root);
    const again = migrateLegacyProject(root);
    expect(again.migrated).toBe(false);
  });

  it("resolution prefers .baton after migration", () => {
    makeLegacyProject();
    migrateLegacyProject(root);
    expect(resolveBatonDirName(root)).toBe(".baton");
  });

  it("resolution falls back to legacy before migration", () => {
    makeLegacyProject();
    expect(resolveBatonDirName(root)).toBe(".threadline");
    // And loading config from the legacy dir works during the transition.
    expect(loadConfig(root).project_id).toBe("sha256:legacy");
  });
});
