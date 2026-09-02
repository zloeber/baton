/**
 * Canonical Baton handoff schema (spec §7).
 *
 * Invariants enforced here:
 * - Canonical data is UTF-8 JSON, schema-versioned, one handoff per file.
 * - `passthrough()` object shapes preserve unknown fields on read/write
 *   (spec §7.1 forward compatibility, §21.5).
 * - No transcript field exists in v0.1; policy rejects any added one (§16).
 */
import { z } from "zod";

export const SCHEMA_VERSION = "0.1";
export const SCHEMA_ID = "https://baton.dev/schemas/handoff/v0.1.json";

export const HandoffStatus = z.enum([
  "draft",
  "validated",
  "ready",
  "resumed",
  "superseded",
  "archived",
]);
export type HandoffStatus = z.infer<typeof HandoffStatus>;

/** Terminal-until-revised flags, orthogonal to `status` (spec §5). */
export const HandoffFlag = z.enum(["invalid", "conflicted"]);
export type HandoffFlag = z.infer<typeof HandoffFlag>;

export const EvidenceType = z.enum(["command", "test", "file", "commit", "url", "human"]);
export type EvidenceType = z.infer<typeof EvidenceType>;

export const ArtifactRole = z.enum(["modified", "created", "read", "generated"]);
export type ArtifactRole = z.infer<typeof ArtifactRole>;

export const Priority = z.enum(["high", "medium", "low"]);
export type Priority = z.infer<typeof Priority>;

export const Relation = z.enum(["root", "continue", "fork", "merge", "amend"]);
export type Relation = z.infer<typeof Relation>;

export const Harness = z.enum(["codex", "claude-code", "cursor", "gemini-cli", "generic"]);
export type Harness = z.infer<typeof Harness>;

export const ActorType = z.enum(["agent", "human", "mixed"]);
export type ActorType = z.infer<typeof ActorType>;

export const Trigger = z.enum(["manual", "threshold", "hook", "timeout", "pre_compaction"]);
export type Trigger = z.infer<typeof Trigger>;

export const ValidationStatus = z.enum(["pass", "warn", "fail", "not_run"]);
export type ValidationStatus = z.infer<typeof ValidationStatus>;

export const isoTimestamp = z
  .string()
  .refine((s) => !Number.isNaN(Date.parse(s)), {
    message: "must be an RFC 3339 / ISO-8601 timestamp",
  });

const structuredId = z
  .string()
  .regex(/^[A-Z]-\d{3}$/, "structured ids look like D-001 / E-001 / O-001");

export const ProjectInfoSchema = z
  .object({
    id: z.string().min(1),
    root_hint: z.string(),
    repository: z
      .object({
        vcs: z.string().nullable(),
        remote_hint: z.string().nullable(),
        head: z.string().nullable(),
        dirty: z.boolean().nullable(),
      })
      .passthrough()
      .nullable(),
  })
  .passthrough();
export type ProjectInfo = z.infer<typeof ProjectInfoSchema>;

export const OriginInfoSchema = z
  .object({
    harness: Harness,
    adapter_version: z.string().nullable(),
    session_id: z.string().nullable(),
    model: z.string().nullable(),
    actor: z
      .object({ type: ActorType, name: z.string().nullable() })
      .passthrough()
      .nullable(),
  })
  .passthrough();
export type OriginInfo = z.infer<typeof OriginInfoSchema>;

export function defaultOrigin(): OriginInfo {
  return {
    harness: "generic",
    adapter_version: null,
    session_id: null,
    model: null,
    actor: null,
  };
}

export const WorkInfoSchema = z
  .object({
    title: z.string().min(1),
    objective: z.string().min(1),
    scope: z.array(z.string()),
    constraints: z.array(z.string()),
    definition_of_done: z.array(z.string()),
  })
  .passthrough();
export type WorkInfo = z.infer<typeof WorkInfoSchema>;

export const SummaryInfoSchema = z
  .object({
    completed: z.array(z.string()),
    current_state: z.string().min(1),
    why_it_matters: z.string().nullable(),
  })
  .passthrough();
export type SummaryInfo = z.infer<typeof SummaryInfoSchema>;

export const DecisionSchema = z
  .object({
    id: structuredId,
    decision: z.string().min(1),
    rationale: z.string().nullable(),
    alternatives_considered: z.array(z.string()),
    evidence_ids: z.array(z.string()),
    made_at: isoTimestamp,
  })
  .passthrough();
export type Decision = z.infer<typeof DecisionSchema>;

export const ArtifactSchema = z
  .object({
    path: z.string().min(1),
    role: ArtifactRole,
    description: z.string().nullable(),
    revision: z.string().nullable(),
    content_hash: z.string().nullable(),
    sensitive: z.boolean(),
  })
  .passthrough();
export type Artifact = z.infer<typeof ArtifactSchema>;

export const EvidenceSchema = z
  .object({
    id: structuredId,
    type: EvidenceType,
    claim: z.string().min(1),
    ref: z.string().nullable(),
    captured_at: isoTimestamp,
    result: z.string().nullable(),
    digest: z.string().nullable(),
  })
  .passthrough();
export type Evidence = z.infer<typeof EvidenceSchema>;

export const OpenItemSchema = z
  .object({
    id: structuredId,
    priority: Priority,
    description: z.string().min(1),
    suggested_action: z.string().nullable(),
    blocked_by: z.array(z.string()),
    acceptance_check: z.string().nullable(),
  })
  .passthrough();
export type OpenItem = z.infer<typeof OpenItemSchema>;

export const RiskSchema = z
  .object({
    description: z.string().min(1),
    severity: Priority,
    mitigation: z.string().nullable(),
  })
  .passthrough();
export type Risk = z.infer<typeof RiskSchema>;

export const ValidationCheckSchema = z
  .object({
    name: z.string().min(1),
    status: z.enum(["pass", "warn", "fail", "skipped"]),
    detail: z.string(),
  })
  .passthrough();
export type ValidationCheck = z.infer<typeof ValidationCheckSchema>;

export const FreshnessSchema = z
  .object({
    git_head_at_capture: z.string().nullable(),
    git_head_now: z.string().nullable(),
    stale: z.boolean(),
  })
  .passthrough();
export type Freshness = z.infer<typeof FreshnessSchema>;

export const ValidationBlockSchema = z
  .object({
    status: ValidationStatus,
    validated_at: isoTimestamp.nullable(),
    checks: z.array(ValidationCheckSchema),
    freshness: FreshnessSchema.nullable(),
  })
  .passthrough();
export type ValidationBlock = z.infer<typeof ValidationBlockSchema>;

export function defaultValidationBlock(): ValidationBlock {
  return {
    status: "not_run",
    validated_at: null,
    checks: [],
    freshness: null,
  };
}

export const LineageInfoSchema = z
  .object({
    parents: z.array(z.string()),
    relation: Relation,
    branch_label: z.string().nullable(),
    merge_basis: z.array(z.string()),
  })
  .passthrough();
export type LineageInfo = z.infer<typeof LineageInfoSchema>;

export function defaultLineage(): LineageInfo {
  return { parents: [], relation: "root", branch_label: null, merge_basis: [] };
}

export const AutomationInfoSchema = z
  .object({
    trigger: Trigger,
    score: z.number().min(0).max(1).nullable(),
    reasons: z.array(z.string()),
  })
  .passthrough();
export type AutomationInfo = z.infer<typeof AutomationInfoSchema>;

export function defaultAutomation(): AutomationInfo {
  return { trigger: "manual", score: null, reasons: [] };
}

export const RedactionRecordSchema = z
  .object({
    field: z.string().min(1),
    reason: z.string().min(1),
    replacement: z.string(),
  })
  .passthrough();
export type RedactionRecord = z.infer<typeof RedactionRecordSchema>;

/**
 * Conflict list attached by `merge` (spec §14). Extension field kept
 * forward-compatible via passthrough; documented in the JSON Schema.
 */
export const ConflictRecordSchema = z
  .object({
    subject: z.string(),
    parent_ids: z.array(z.string()),
    positions: z.array(
      z.object({ handoff_id: z.string(), decision_id: z.string(), decision: z.string() }).passthrough(),
    ),
    resolution_decision_id: z.string().nullable(),
  })
  .passthrough();
export type ConflictRecord = z.infer<typeof ConflictRecordSchema>;

export const HandoffSchema = z
  .object({
    $schema: z.string(),
    schema_version: z.string(),
    id: z.string().uuid(),
    kind: z.literal("handoff"),
    status: HandoffStatus,
    flags: z.array(HandoffFlag),
    created_at: isoTimestamp,
    updated_at: isoTimestamp,
    project: ProjectInfoSchema,
    origin: OriginInfoSchema,
    work: WorkInfoSchema,
    summary: SummaryInfoSchema,
    decisions: z.array(DecisionSchema),
    artifacts: z.array(ArtifactSchema),
    evidence: z.array(EvidenceSchema),
    open_items: z.array(OpenItemSchema),
    risks: z.array(RiskSchema),
    validation: ValidationBlockSchema,
    lineage: LineageInfoSchema,
    automation: AutomationInfoSchema,
    redactions: z.array(RedactionRecordSchema),
  })
  .passthrough();
export type Handoff = z.infer<typeof HandoffSchema>;

/**
 * Loose shape accepted from operators/agents before normalization.
 * Unknown top-level fields pass through (spec §7.1).
 */
export const HandoffInputSchema = HandoffSchema.partial({
  $schema: true,
  schema_version: true,
  id: true,
  kind: true,
  status: true,
  flags: true,
  created_at: true,
  updated_at: true,
  project: true,
  origin: true,
  validation: true,
  lineage: true,
  automation: true,
  redactions: true,
  decisions: true,
  artifacts: true,
  evidence: true,
  open_items: true,
  risks: true,
}).passthrough();
export type HandoffInput = z.infer<typeof HandoffInputSchema>;

/** Draft-stage required fields (spec §7.2). Belt-and-braces after parse. */
export function checkDraftRequirements(h: Handoff): string[] {
  const missing: string[] = [];
  if (!h.id) missing.push("id");
  if (!h.created_at || !h.updated_at) missing.push("created_at/updated_at");
  if (!h.project?.id) missing.push("project.id");
  if (!h.work?.title) missing.push("work.title");
  if (!h.work?.objective) missing.push("work.objective");
  if (!h.summary?.current_state) missing.push("summary.current_state");
  if (!h.lineage) missing.push("lineage");
  return missing;
}

/** Extra requirements before a handoff may become `ready` (spec §7.2). */
export function checkReadinessRequirements(h: Handoff): string[] {
  const problems: string[] = [];
  const hasOpenActionable = h.open_items.some(
    (o) => o.suggested_action !== null && o.suggested_action !== undefined,
  );
  const workComplete = h.open_items.length === 0 && h.summary.completed.length > 0;
  if (!hasOpenActionable && !workComplete) {
    problems.push(
      "ready requires at least one open item with a suggested_action, or an explicitly completed work state",
    );
  }
  const v = h.validation.status;
  if (v !== "pass" && v !== "warn") {
    problems.push(`validation.status must be pass or warn before ready (got ${v})`);
  }
  if (h.flags.includes("invalid")) {
    problems.push("handoff is flagged invalid; amend before promoting");
  }
  if (h.flags.includes("conflicted")) {
    problems.push("handoff is flagged conflicted; supply a resolution before promoting");
  }
  return problems;
}
