import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { initProject, ProjectStore } from "@baton/core";
import { SqliteIndex } from "../src/sqliteIndex.js";

let root: string;
let index: SqliteIndex;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "baton-idx-"));
  initProject(root);
  index = new SqliteIndex(root);
});

afterEach(() => {
  index.close();
  rmSync(root, { recursive: true, force: true });
});

describe("SqliteIndex", () => {
  it("rebuilds from canonical records and answers filtered queries", () => {
    const store = new ProjectStore(root);
    store.create({
      work: { title: "Alpha work", objective: "Objective alpha.", scope: [], constraints: [], definition_of_done: [] },
      summary: { completed: [], current_state: "state", why_it_matters: null },
    });
    store.create({
      work: { title: "Beta work", objective: "Objective beta.", scope: [], constraints: [], definition_of_done: [] },
      summary: { completed: [], current_state: "state", why_it_matters: null },
    });
    index.rebuild(store.indexEntries());
    expect(index.query()).toHaveLength(2);
    expect(index.query({ work: "beta" })[0]!.title).toBe("Beta work");
    expect(index.query({ status: "ready" })).toHaveLength(0);
    expect(index.counts().draft).toBe(2);
  });

  it("survives deletion and rebuild (JSON remains source of truth)", () => {
    const store = new ProjectStore(root);
    store.create({
      work: { title: "Solo", objective: "Objective.", scope: [], constraints: [], definition_of_done: [] },
      summary: { completed: [], current_state: "state", why_it_matters: null },
    });
    index.rebuild(store.indexEntries());
    index.close();
    rmSync(join(root, ".baton/index.sqlite"));
    const again = new SqliteIndex(root);
    expect(again.query()).toHaveLength(0);
    again.rebuild(store.indexEntries());
    expect(again.query()).toHaveLength(1);
    again.close();
    index = again;
  });

  it("persists detector suppression state across connections", () => {
    index.setDetectorState({ last_prompt_at: "2026-09-02T12:00:00Z", last_pressure: 0.82 });
    index.close();
    const again = new SqliteIndex(root);
    const s = again.getDetectorState();
    expect(s.last_prompt_at).toBe("2026-09-02T12:00:00Z");
    expect(s.last_pressure).toBeCloseTo(0.82);
    // Omitting a field preserves it (COALESCE upsert).
    again.setDetectorState({ last_pressure: 0.9 });
    expect(again.getDetectorState().last_prompt_at).toBe("2026-09-02T12:00:00Z");
    expect(again.getDetectorState().last_pressure).toBeCloseTo(0.9);
    again.setDetectorState({ session_id: "s-abc" });
    again.close();
    const third = new SqliteIndex(root);
    expect(third.getDetectorState().last_pressure).toBeCloseTo(0.9);
    third.close();
    index = third;
  });

  it("records local metrics", () => {
    index.recordMetric("detector_recommend", 1);
    index.recordMetric("validation_pass", 1);
    expect(index.metrics()).toHaveLength(2);
  });
});
