import { mkdtempSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { ProjectStore } from "../src/projectStore.js";
import { HandoffNotFoundError } from "../src/projectStore.js";

function tmpProject(): string {
  return mkdtempSync(join(tmpdir(), "baton-store-"));
}

function draftInput(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    work: {
      title: "Test work item",
      objective: "Finish the test work item with passing checks.",
      scope: [],
      constraints: [],
      definition_of_done: [],
    },
    summary: { completed: [], current_state: "In progress.", why_it_matters: null },
    ...over,
  };
}

let root: string;
let store: ProjectStore;

beforeEach(() => {
  root = tmpProject();
  store = new ProjectStore(root);
});

describe("ProjectStore", () => {
  it("creates a draft with defaults, id, and timestamps", () => {
    const h = store.create(draftInput());
    expect(h.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(h.status).toBe("draft");
    expect(h.kind).toBe("handoff");
    expect(h.schema_version).toBe("0.1");
    expect(h.validation.status).toBe("not_run");
    expect(h.created_at).toBe(h.updated_at);
  });

  it("writes canonical file names <created-at>--<short-id>.json", () => {
    const h = store.create(draftInput());
    expect(existsSync(store.pathFor(h))).toBe(true);
    expect(store.fileNameFor(h)).toMatch(/^\d{8}T\d{6}Z--[0-9a-f]{8}\.json$/);
  });

  it("round-trips through disk preserving unknown fields (§21.5)", () => {
    const h = store.create({ ...draftInput(), vendor_extension: { keep: true } });
    const raw = JSON.parse(readFileSync(store.pathFor(h), "utf8")) as Record<string, unknown>;
    expect(raw["vendor_extension"]).toEqual({ keep: true });
    const loaded = store.loadOrThrow(h.id);
    expect((loaded as unknown as Record<string, unknown>)["vendor_extension"]).toEqual({ keep: true });
  });

  it("refuses draft input missing required work/summary", () => {
    expect(() => store.create({ work: { title: "x", objective: "y" } })).toThrow(
      /draft requirements not met/,
    );
  });

  it("refuses duplicate file for identical id", () => {
    const input = { ...draftInput(), id: "0198c0de-7000-7000-8000-0000000000aa" };
    store.create(input, new Date("2026-09-02T10:00:00Z"));
    expect(() => store.create(input, new Date("2026-09-02T10:00:00Z"))).toThrow(
      /refusing to overwrite/,
    );
  });

  it("loads by exact id and by unique prefix", () => {
    const h = store.create(draftInput());
    expect(store.loadOrThrow(h.id).id).toBe(h.id);
    expect(store.loadOrThrow(h.id.replace(/-/g, "").slice(0, 10)).id).toBe(h.id);
    expect(store.load("zzzzzzzz")).toBeNull();
    expect(() => store.loadOrThrow("zzzzzzzz")).toThrow(HandoffNotFoundError);
  });

  it("reports broken files without losing the rest", () => {
    mkdirSync(store.handoffsPath, { recursive: true });
    writeFileSync(join(store.handoffsPath, "broken.json"), "{ not json");
    const h = store.create(draftInput());
    expect(store.listAll().map((x) => x.id)).toEqual([h.id]);
    expect(store.brokenFiles()).toHaveLength(1);
  });

  it("builds index entries from records alone", () => {
    const h = store.create(draftInput());
    const entries = store.indexEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ id: h.id, status: "draft", title: "Test work item" });
  });

  it("deletes by id", () => {
    const h = store.create(draftInput());
    expect(store.delete(h.id)).toBe(true);
    expect(store.load(h.id)).toBeNull();
    expect(store.delete(h.id)).toBe(false);
  });

  it("computes a stable project id", () => {
    const a = ProjectStore.projectId(root);
    const b = ProjectStore.projectId(root);
    expect(a).toBe(b);
    expect(a).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});
