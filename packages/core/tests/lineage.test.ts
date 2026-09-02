import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ProjectStore } from "../src/projectStore.js";
import {
  buildGraph,
  createFork,
  createMerge,
  findDecisionConflicts,
  MergeConflictError,
  normalizeDecisionSubject,
  renderLineageAscii,
  supersedePredecessors,
} from "../src/lineage.js";
import { transitionHandoff } from "../src/stateMachine.js";

let root: string;
let store: ProjectStore;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "baton-lineage-"));
  store = new ProjectStore(root);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function draft(over: Record<string, unknown> = {}) {
  return {
    work: {
      title: "Parent work",
      objective: "Objective of the parent work item.",
      scope: [],
      constraints: [],
      definition_of_done: [],
    },
    summary: { completed: ["step one"], current_state: "halfway", why_it_matters: null },
    ...over,
  };
}

describe("fork", () => {
  it("creates an immutable linked child (§22.7)", () => {
    const parent = store.create(draft());
    const child = createFork(store, parent.id, "explore-cache");
    expect(child.lineage).toMatchObject({
      relation: "fork",
      branch_label: "explore-cache",
      parents: [parent.id],
    });
    expect(child.id).not.toBe(parent.id);
    // parent unchanged and still loadable with original status
    expect(store.loadOrThrow(parent.id).status).toBe("draft");
  });

  it("inherits decisions as context", () => {
    const parent = store.create(
      draft({
        decisions: [
          {
            id: "D-001",
            decision: "Use sqlite for the index.",
            rationale: null,
            alternatives_considered: [],
            evidence_ids: [],
            made_at: "2026-09-02T10:00:00Z",
          },
        ],
      }),
    );
    const child = createFork(store, parent.id, "alt");
    expect(child.decisions.map((d) => d.decision)).toContain("Use sqlite for the index.");
  });
});

describe("merge", () => {
  it("fails without explicit resolution when decisions conflict (§22.7)", () => {
    const a = store.create(
      draft({
        decisions: [
          {
            id: "D-001",
            decision: "Use PostgreSQL for storage.",
            rationale: null,
            alternatives_considered: [],
            evidence_ids: [],
            made_at: "2026-09-02T10:00:00Z",
          },
        ],
      }),
    );
    const b = store.create(
      draft({
        decisions: [
          {
            id: "D-001",
            decision: "Use SQLite for storage.",
            rationale: null,
            alternatives_considered: [],
            evidence_ids: [],
            made_at: "2026-09-02T10:00:00Z",
          },
        ],
      }),
    );
    expect(() =>
      createMerge(store, [a.id, b.id], {
        title: "",
        objective: "Combined objective.",
        current_state: "combined",
        decision: "",
      }),
    ).toThrow(MergeConflictError);
  });

  it("succeeds with an explicit resolution decision", () => {
    const a = store.create(
      draft({
        decisions: [
          {
            id: "D-001",
            decision: "Use PostgreSQL for storage.",
            rationale: null,
            alternatives_considered: [],
            evidence_ids: [],
            made_at: "2026-09-02T10:00:00Z",
          },
        ],
      }),
    );
    const b = store.create(
      draft({
        decisions: [
          {
            id: "D-001",
            decision: "Use SQLite for storage.",
            rationale: null,
            alternatives_considered: [],
            evidence_ids: [],
            made_at: "2026-09-02T10:00:00Z",
          },
        ],
      }),
    );
    const merged = createMerge(store, [a.id, b.id], {
      title: "Merged storage work",
      objective: "Combined objective.",
      current_state: "combined state",
      decision: "Use SQLite; PostgreSQL was rejected for local-first requirement.",
    });
    expect(merged.lineage.relation).toBe("merge");
    expect(merged.lineage.parents).toHaveLength(2);
    expect(merged.lineage.parents).toContain(a.id);
    expect(merged.lineage.parents).toContain(b.id);
    expect(merged.decisions.some((d) => d.decision.includes("explicit merge resolution") || d.decision.includes("Use SQLite"))).toBe(true);
    expect((merged as unknown as Record<string, unknown>)["conflicts"]).toBeTruthy();
  });

  it("requires two parents", () => {
    const a = store.create(draft());
    expect(() =>
      createMerge(store, [a.id], { title: "", objective: "x", current_state: "y", decision: "z" }),
    ).toThrow(/two or more/);
  });

  it("merges without conflicts need no resolution decision text", () => {
    const a = store.create(draft());
    const b = store.create(
      draft({
        work: {
          title: "Other work",
          objective: "Different objective entirely.",
          scope: [],
          constraints: [],
          definition_of_done: [],
        },
        summary: { completed: [], current_state: "different state", why_it_matters: null },
      }),
    );
    const merged = createMerge(store, [a.id, b.id], {
      title: "M",
      objective: "objective",
      current_state: "state",
      decision: "",
    });
    expect(merged.status).toBe("draft");
  });
});

describe("conflict detection", () => {
  it("normalizes subjects so punctuation does not hide conflicts", () => {
    expect(normalizeDecisionSubject("Use SQLite for storage.")).toBe(
      normalizeDecisionSubject("use  sqlite for storage"),
    );
  });

  it("does not flag identical decisions repeated across handoffs", () => {
    const same = {
      decisions: [
        {
          id: "D-001",
          decision: "Same decision.",
          rationale: null,
          alternatives_considered: [],
          evidence_ids: [],
          made_at: "2026-09-02T10:00:00Z",
        },
      ],
    };
    const a = store.create(draft(same));
    const b = store.create(draft({ ...draft(), ...same }));
    expect(findDecisionConflicts([store.loadOrThrow(a.id), store.loadOrThrow(b.id)])).toEqual([]);
  });
});

describe("supersede + graph", () => {
  it("supersedes ready parents after a continuation child exists", () => {
    const parent = store.create(draft());
    store.update(transitionHandoff(store.loadOrThrow(parent.id), "ready"));
    const child = store.create({
      ...draft({
        work: {
          title: "Child work",
          objective: "Continue the parent work.",
          scope: [],
          constraints: [],
          definition_of_done: [],
        },
        summary: { completed: [], current_state: "resumed", why_it_matters: null },
      }),
      lineage: { parents: [parent.id], relation: "continue", branch_label: null, merge_basis: [] },
    });
    const superseded = supersedePredecessors(store, store.loadOrThrow(child.id));
    expect(superseded).toEqual([parent.id]);
    expect(store.loadOrThrow(parent.id).status).toBe("superseded");
  });

  it("renders an ascii graph from records alone", () => {
    const parent = store.create(draft());
    const child = createFork(store, parent.id, "explore");
    const graph = buildGraph(store);
    const ascii = renderLineageAscii(graph);
    expect(ascii).toContain(parent.id.slice(0, 8));
    expect(ascii).toContain(child.id.slice(0, 8));
    expect(ascii).toContain("[explore]");
  });
});
