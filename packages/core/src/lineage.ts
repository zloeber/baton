/**
 * Lineage (spec §5, §14): continuation, forks, merges, and amendment as
 * graph relationships over immutable records. Graph traversal works from
 * records alone; any index is only an optimization.
 */
import { Handoff } from "./schema.js";
import { ProjectStore } from "./projectStore.js";
import { nowIso } from "./time.js";

export function normalizeDecisionSubject(decision: string): string {
  return decision
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function wordSet(text: string): Set<string> {
  return new Set(normalizeDecisionSubject(text).split(" ").filter(Boolean));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 1 : inter / union;
}

/**
 * Two decisions describe the same subject when they share most of their
 * words (Jaccard >= 0.6, a documented heuristic for v0.1) or carry the same
 * structured id with differing text (spec §14: "same normalized decision
 * subject with differing values, or by ID").
 */
function sameSubjectDifferentValue(a: string, b: string, aId: string, bId: string): boolean {
  const na = normalizeDecisionSubject(a);
  const nb = normalizeDecisionSubject(b);
  if (na === nb) return false; // identical positions are not conflicts
  if (aId === bId) return true;
  return jaccard(wordSet(a), wordSet(b)) >= 0.6;
}

export interface DecisionConflict {
  subject: string;
  positions: { handoff_id: string; decision_id: string; decision: string }[];
}

/**
 * Detect conflicting decisions: same normalized subject with differing
 * values, either inside one handoff or across a set of parents.
 */
export function findDecisionConflicts(handoffs: Handoff[]): DecisionConflict[] {
  const all: { handoff_id: string; id: string; decision: string }[] = [];
  for (const h of handoffs) {
    for (const d of h.decisions) {
      all.push({ handoff_id: h.id, id: d.id, decision: d.decision });
    }
  }
  const conflicts: DecisionConflict[] = [];
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const a = all[i]!;
      const b = all[j]!;
      if (sameSubjectDifferentValue(a.decision, b.decision, a.id, b.id)) {
        const existing = conflicts.find((c) =>
          c.positions.some(
            (p) => p.decision === a.decision || p.decision === b.decision,
          ),
        );
        if (existing) {
          for (const p of [a, b]) {
            if (!existing.positions.some((x) => x.decision === p.decision)) {
              existing.positions.push({ handoff_id: p.handoff_id, decision_id: p.id, decision: p.decision });
            }
          }
        } else {
          conflicts.push({
            subject: normalizeDecisionSubject(a.decision),
            positions: [
              { handoff_id: a.handoff_id, decision_id: a.id, decision: a.decision },
              { handoff_id: b.handoff_id, decision_id: b.id, decision: b.decision },
            ],
          });
        }
      }
    }
  }
  return conflicts;
}

/** Create a fork child of `parentId` (immutable parent, linked child). */
export function createFork(store: ProjectStore, parentId: string, label: string, now: Date = new Date()): Handoff {
  const parent = store.loadOrThrow(parentId);
  return store.create(
    {
      ...inheritContext(parent),
      work: { ...parent.work },
      summary: { ...parent.summary },
      origin: { ...parent.origin },
      project: { ...parent.project },
      lineage: {
        parents: [parent.id],
        relation: "fork",
        branch_label: label,
        merge_basis: [],
      },
      automation: { trigger: "manual", score: null, reasons: ["fork of " + parent.id] },
      created_at: now.toISOString(),
    },
    now,
  );
}

/** Create an amendment child (corrected successor of a ready record). */
export function createAmendment(store: ProjectStore, parentId: string, now: Date = new Date()): Handoff {
  const parent = store.loadOrThrow(parentId);
  return store.create(
    {
      ...inheritContext(parent),
      work: { ...parent.work },
      summary: { ...parent.summary },
      origin: { ...parent.origin },
      project: { ...parent.project },
      lineage: {
        parents: [parent.id],
        relation: "amend",
        branch_label: parent.lineage.branch_label,
        merge_basis: [],
      },
      automation: { trigger: "manual", score: null, reasons: ["amendment of " + parent.id] },
    },
    now,
  );
}

/** Inherit parent decision set as context — not copied as mutable data. */
function inheritContext(parent: Handoff): Record<string, unknown> {
  return {
    decisions: parent.decisions.map((d) => ({ ...d })),
    evidence: parent.evidence.map((e) => ({ ...e })),
    failed_attempts: parent.failed_attempts.map((f) => ({ ...f })),
    risks: parent.risks.map((r) => ({ ...r })),
    redactions: [],
    validation: {
      status: "not_run",
      validated_at: null,
      checks: [],
      freshness: null,
    },
    flags: [],
  };
}

export class MergeConflictError extends Error {
  readonly code = "CONFLICT";
  constructor(public readonly conflicts: DecisionConflict[]) {
    super(
      `merge blocked: ${conflicts.length} conflicting decision(s) require an explicit resolution`,
    );
    this.name = "MergeConflictError";
  }
}

/**
 * Merge two or more parents into a new draft. Per §22.7, a merge fails until
 * an explicit resolution decision is supplied (`resolution` field).
 */
export function createMerge(
  store: ProjectStore,
  parentIds: string[],
  resolution: { title: string; objective: string; current_state: string; decision: string },
  now: Date = new Date(),
): Handoff {
  const uniqueIds = [...new Set(parentIds)];
  if (uniqueIds.length < 2) {
    const e = new Error("merge requires two or more parent handoffs") as Error & { code: string };
    e.code = "USER";
    throw e;
  }
  const parents = uniqueIds.map((id) => store.loadOrThrow(id));
  const conflicts = findDecisionConflicts(parents);
  const hasResolution = resolution.decision.trim().length > 0;
  if (conflicts.length > 0 && !hasResolution) {
    throw new MergeConflictError(conflicts);
  }
  const first = parents[0]!;
  const child = store.create(
    {
      work: {
        title: resolution.title || first.work.title,
        objective: resolution.objective,
        scope: [...new Set(parents.flatMap((p) => p.work.scope))],
        constraints: [...new Set(parents.flatMap((p) => p.work.constraints))],
        definition_of_done: [...new Set(parents.flatMap((p) => p.work.definition_of_done))],
      },
      summary: {
        completed: [...new Set(parents.flatMap((p) => p.summary.completed))],
        current_state: resolution.current_state,
        why_it_matters: first.summary.why_it_matters,
      },
      origin: { ...first.origin },
      project: { ...first.project },
      decisions: [
        ...parents.flatMap((p) => p.decisions.map((d) => ({ ...d }))),
        ...(hasResolution
          ? [
              {
                id: "D-001",
                decision: resolution.decision,
                rationale: "explicit merge resolution (spec §14)",
                alternatives_considered: [],
                evidence_ids: [],
                made_at: now.toISOString(),
              },
            ]
          : []),
      ],
      open_items: parents.flatMap((p) => p.open_items.map((o) => ({ ...o }))),
      evidence: parents.flatMap((p) => p.evidence.map((e) => ({ ...e }))),
      failed_attempts: parents.flatMap((p) => p.failed_attempts.map((f) => ({ ...f }))),
      artifacts: parents.flatMap((p) => p.artifacts.map((a) => ({ ...a }))),
      risks: parents.flatMap((p) => p.risks.map((r) => ({ ...r }))),
      lineage: {
        parents: parents.map((p) => p.id),
        relation: "merge" as const,
        branch_label: null,
        merge_basis: parents.map((p) => p.id),
      },
      automation: { trigger: "manual", score: null, reasons: ["merge of " + parents.map((p) => p.id).join(" + ")] },
      created_at: now.toISOString(),
    },
    now,
  );
  // Record conflicts on the child as an extension field (§14 conflict list).
  if (conflicts.length > 0) {
    child["conflicts"] = conflicts.map((c) => ({
      subject: c.subject,
      parent_ids: [...new Set(c.positions.map((p) => p.handoff_id))],
      positions: c.positions,
      resolution_decision_id: "D-001",
    }));
  }
  return store.update(child);
}

/** Mark predecessors superseded after a continuation/merge becomes current. */
export function supersedePredecessors(store: ProjectStore, child: Handoff, now: Date = new Date()): string[] {
  const superseded: string[] = [];
  if (child.lineage.relation === "root") return superseded;
  for (const parentId of child.lineage.parents) {
    const parent = store.load(parentId);
    if (parent && parent.status === "ready") {
      store.update({ ...parent, status: "superseded", updated_at: now.toISOString() });
      superseded.push(parentId);
    }
  }
  return superseded;
}

export interface LineageNode {
  id: string;
  status: string;
  relation: string;
  branch_label: string | null;
  title: string;
  parents: string[];
}

/** Build the lineage graph purely from records. */
export function buildGraph(store: ProjectStore): LineageNode[] {
  return store.listAll().map((h) => ({
    id: h.id,
    status: h.status,
    relation: h.lineage.relation,
    branch_label: h.lineage.branch_label,
    title: h.work.title,
    parents: h.lineage.parents,
  }));
}

/** Compact ASCII lineage rendering (roots first, indented children). */
export function renderLineageAscii(nodes: LineageNode[]): string {
  const byParent = new Map<string, LineageNode[]>();
  const roots: LineageNode[] = [];
  const byId = new Map(nodes.map((n) => [n.id, n] as const));
  for (const n of nodes) {
    const visibleParent = n.parents.find((p) => byId.has(p));
    if (n.relation === "root" || visibleParent === undefined) {
      roots.push(n);
    } else {
      const list = byParent.get(visibleParent) ?? [];
      list.push(n);
      byParent.set(visibleParent, list);
    }
  }
  const lines: string[] = [];
  const walk = (n: LineageNode, depth: number): void => {
    const label = n.branch_label ? ` [${n.branch_label}]` : "";
    lines.push(
      `${"  ".repeat(depth)}${depth === 0 ? "●" : "└─"} ${n.id.slice(0, 8)} ${n.relation}${label} (${n.status}) ${n.title}`,
    );
    for (const c of byParent.get(n.id) ?? []) walk(c, depth + 1);
  };
  for (const r of roots) walk(r, 0);
  return lines.join("\n");
}
