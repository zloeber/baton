/**
 * MCP tool implementations (spec §13). These wrap @baton/core with the
 * same semantics as the CLI commands, honoring project root/policy limits.
 * Every tool returns structured content plus a concise text summary.
 */
import {
  auditHandoff,
  buildGraph,
  captureGitInfo,
  checkReadinessRequirements,
  Config,
  createFork,
  createMerge,
  computeFreshness,
  DetectorSignals,
  evaluateEvent,
  Handoff,
  HandoffNotFoundError,
  initProject,
  isInitialized,
  loadConfig,
  loadDetectorState,
  MergeConflictError,
  nullSignals,
  opaqueSessionId,
  ProjectStore,
  redactDocument,
  renderLineageAscii,
  renderMarkdown,
  renderResumePrompt,
  saveDetectorState,
  transitionHandoff,
  Validator,
} from "@baton/core";
import {
  HandoffCaptureRequest,
  HandoffResumeBrief,
  McpToolResult,
} from "./contract.js";

export interface ToolContext {
  rootDir: string;
  store: ProjectStore;
  config: Config;
  requireInitialized: () => void;
}

export function makeContext(rootDir: string): ToolContext {
  const store = new ProjectStore(rootDir);
  const config = loadConfig(rootDir);
  return {
    rootDir,
    store,
    config,
    requireInitialized: () => {
      if (!isInitialized(rootDir)) {
        const e = new Error("project not initialized; call baton_init or run `baton init`");
        (e as unknown as { code: string }).code = "POLICY";
        throw e;
      }
    },
  };
}

function ok<T>(structured: T, text: string): McpToolResult<T> {
  return { structured, text, isError: false };
}

function fail<T = unknown>(message: string, code: string, structured: Record<string, unknown> = {}): McpToolResult<T> {
  return { structured: { error: code, message, ...structured } as unknown as T, text: `Error (${code}): ${message}`, isError: true };
}

/** Returns a policy error result when the project is not initialized. */
function guard<T>(ctx: ToolContext): McpToolResult<T> | null {
  try {
    ctx.requireInitialized();
    return null;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return fail<T>(message, "POLICY");
  }
}

// ------------------------------------------------------------ baton_status

export function batonStatus(ctx: ToolContext): McpToolResult {
  const initialized = isInitialized(ctx.rootDir);
  const handoffs = initialized ? ctx.store.listAll() : [];
  const latest = handoffs.length > 0 ? handoffs[handoffs.length - 1]! : null;
  const git = captureGitInfo(ctx.rootDir);
  return ok(
    {
      root: ctx.rootDir,
      initialized,
      latest: latest ? { id: latest.id, status: latest.status, title: latest.work.title } : null,
      git,
      detector_available: true,
      handoff_count: handoffs.length,
    },
    initialized
      ? `Initialized. ${handoffs.length} handoff(s); latest: ${latest ? `${latest.id.slice(0, 8)} (${latest.status}) ${latest.work.title}` : "none"}. Git head: ${git.head ?? "n/a"}.`
      : "Not initialized; run `baton init` in this project.",
  );
}

export function batonInit(ctx: ToolContext): McpToolResult {
  const r = initProject(ctx.rootDir);
  return ok(r, `Initialized ${ctx.rootDir}.`);
}

// ------------------------------------------------------------ handoff_capture

export function handoffCapture(ctx: ToolContext, req: HandoffCaptureRequest): McpToolResult<Handoff> {
  const blocked = guard<Handoff>(ctx);
  if (blocked) return blocked;
  const now = new Date();
  const git = captureGitInfo(ctx.rootDir);
  const sessionId = loadDetectorState(ctx.rootDir).session_id;
  const candidate = {
    project: {
      id: ctx.store.projectInfo().id,
      root_hint: ".",
      repository: git.vcs === "git" ? git : null,
    },
    origin: {
      harness: "generic" as const,
      adapter_version: "mcp-0.1.0",
      session_id: sessionId,
      model: null,
      actor: { type: "agent" as const, name: null },
    },
    work: {
      title: req.work.title,
      objective: req.work.objective,
      scope: req.work.scope ?? [],
      constraints: req.work.constraints ?? [],
      definition_of_done: req.work.definition_of_done ?? [],
    },
    summary: {
      completed: req.summary.completed ?? [],
      current_state: req.summary.current_state,
      why_it_matters: req.summary.why_it_matters ?? null,
    },
    decisions: (req.decisions ?? []).map((d, i) => ({
      id: d.id ?? `D-${String(i + 1).padStart(3, "0")}`,
      decision: d.decision,
      rationale: d.rationale ?? null,
      alternatives_considered: d.alternatives_considered ?? [],
      evidence_ids: d.evidence_ids ?? [],
      made_at: d.made_at ?? now.toISOString(),
    })),
    artifacts: (req.artifacts ?? []).map((a) => ({
      path: a.path,
      role: a.role,
      description: a.description ?? null,
      revision: null,
      content_hash: a.content_hash ?? null,
      sensitive: a.sensitive ?? false,
    })),
    evidence: (req.evidence ?? []).map((e, i) => ({
      id: e.id ?? `E-${String(i + 1).padStart(3, "0")}`,
      type: e.type,
      claim: e.claim,
      ref: e.ref ?? null,
      captured_at: e.captured_at ?? now.toISOString(),
      result: e.result ?? null,
      digest: e.digest ?? null,
    })),
    open_items: (req.open_items ?? []).map((o, i) => ({
      id: o.id ?? `O-${String(i + 1).padStart(3, "0")}`,
      priority: o.priority,
      description: o.description,
      suggested_action: o.suggested_action ?? null,
      blocked_by: o.blocked_by ?? [],
      acceptance_check: o.acceptance_check ?? null,
    })),
    risks: (req.risks ?? []).map((r) => ({
      description: r.description,
      severity: r.severity,
      mitigation: r.mitigation ?? null,
    })),
    lineage: req.parent
      ? {
          parents: [ctx.store.loadOrThrow(req.parent).id],
          relation: "continue" as const,
          branch_label: null,
          merge_basis: [],
        }
      : { parents: [], relation: "root" as const, branch_label: null, merge_basis: [] },
    automation: {
      trigger: req.trigger ?? ("manual" as const),
      score: req.score ?? null,
      reasons: req.reasons ?? [],
    },
    redactions: [] as unknown[],
  };
  const { doc, redactions } = redactDocument(candidate, ctx.config.policy.secretPatterns);
  const created = ctx.store.create({ ...doc, redactions }, now);
  return ok(
    created,
    `Draft created: ${created.id} (${created.status}) — ${created.work.title}` +
      (redactions.length > 0 ? ` · ${redactions.length} value(s) redacted per policy` : ""),
  );
}

// ----------------------------------------------------------- handoff_validate

export function handoffValidate(ctx: ToolContext, id: string, recheck = false): McpToolResult {
  const blocked = guard(ctx);
  if (blocked) return blocked;
  let h: Handoff;
  try {
    h = ctx.store.loadOrThrow(id);
  } catch (e) {
    if (e instanceof HandoffNotFoundError) return fail(e.message, "NOT_FOUND");
    throw e;
  }
  const validator = new Validator(ctx.rootDir, ctx.config.policy.secretPatterns, {
    allowedRoots: ctx.config.policy.allowedRoots,
    gitHeadNow: captureGitInfo(ctx.rootDir).head,
    recheck,
    recheckAllowlist: (ctx.config as Config & { recheckAllowlist?: string[] }).recheckAllowlist ?? [],
  });
  const report = validator.validate(h);
  if (report.status !== "fail") {
    ctx.store.update({
      ...transitionHandoff(h, h.status === "draft" ? "validated" : h.status),
      validation: {
        status: report.status,
        validated_at: report.validated_at,
        checks: report.checks as unknown as typeof h.validation.checks,
        freshness: h.validation.freshness,
      },
    });
  }
  return ok(
    report,
    `${report.status.toUpperCase()}: ${report.checks.map((c) => `${c.name}=${c.status}`).join(", ")}`,
  );
}

// -------------------------------------------------------------- handoff_ready

export function handoffReady(ctx: ToolContext, id: string, warningAcknowledgement?: string): McpToolResult<Handoff> {
  const blocked = guard<Handoff>(ctx);
  if (blocked) return blocked;
  let h: Handoff;
  try {
    h = ctx.store.loadOrThrow(id);
  } catch (e) {
    if (e instanceof HandoffNotFoundError) return fail(e.message, "NOT_FOUND");
    throw e;
  }
  const validator = new Validator(ctx.rootDir, ctx.config.policy.secretPatterns, {
    allowedRoots: ctx.config.policy.allowedRoots,
    gitHeadNow: captureGitInfo(ctx.rootDir).head,
  });
  const report = validator.validate(h);
  if (report.status === "fail") {
    return fail(`validation failed: ${report.failures.join("; ")}`, "VALIDATION", { report });
  }
  if (report.status === "warn" && !warningAcknowledgement) {
    return fail(
      `warnings require acknowledgement: ${report.warnings.join("; ")}`,
      "VALIDATION",
      { report },
    );
  }
  const readinessProblems = checkReadinessRequirements(h);
  if (readinessProblems.length > 0) {
    return fail(`cannot become ready: ${readinessProblems.join("; ")}`, "VALIDATION", { report });
  }
  const ready = transitionHandoff(
    {
      ...h,
      validation: {
        status: report.status,
        validated_at: report.validated_at,
        checks: report.checks as unknown as typeof h.validation.checks,
        freshness: h.validation.freshness,
      },
    },
    "ready",
  );
  ctx.store.update(ready);
  return ok(ready, `Handoff ${ready.id} is ready.`);
}

// ------------------------------------------------------------- handoff_resume

export function handoffResume(ctx: ToolContext, id: string, format: "prompt" | "md" = "prompt"): McpToolResult<HandoffResumeBrief> {
  const blocked = guard<HandoffResumeBrief>(ctx);
  if (blocked) return blocked;
  let h: Handoff;
  try {
    h = ctx.store.loadOrThrow(id);
  } catch (e) {
    if (e instanceof HandoffNotFoundError) return fail(e.message, "NOT_FOUND");
    throw e;
  }
  const git = captureGitInfo(ctx.rootDir);
  const freshness = computeFreshness(h, ctx.rootDir, git.head);
  const rendered = { ...h, validation: { ...h.validation, freshness } } as Handoff;
  const staleReasons: string[] = [];
  if (
    freshness.git_head_at_capture &&
    freshness.git_head_now &&
    freshness.git_head_at_capture !== freshness.git_head_now
  ) {
    staleReasons.push(
      `git head moved since capture (${freshness.git_head_at_capture} -> ${freshness.git_head_now})`,
    );
  }
  const drifted = (freshness as unknown as { drifted_artifacts?: string[] }).drifted_artifacts;
  if (Array.isArray(drifted)) {
    for (const p of drifted) staleReasons.push(`artifact changed on disk: ${p}`);
  }
  const brief: HandoffResumeBrief = {
    id: h.id,
    title: h.work.title,
    prompt: renderResumePrompt(rendered),
    markdown: renderMarkdown(rendered),
    freshness,
    stale_reasons: staleReasons,
  };
  const text =
    (staleReasons.length > 0
      ? `STALE: ${staleReasons.join("; ")}\n\n`
      : "") + (format === "md" ? brief.markdown : brief.prompt);
  return ok(brief, text);
}

// -------------------------------------------------------------- handoff_list

export function handoffList(
  ctx: ToolContext,
  filters: { status?: string; work?: string } = {},
): McpToolResult {
  const blocked = guard(ctx);
  if (blocked) return blocked;
  const all = ctx.store.listAll().filter(
    (h) =>
      (!filters.status || h.status === filters.status) &&
      (!filters.work || h.work.title.toLowerCase().includes(filters.work!.toLowerCase())),
  );
  return ok(
    { handoffs: all.map((h) => ({ id: h.id, status: h.status, title: h.work.title, created_at: h.created_at, relation: h.lineage.relation })) },
    all.length === 0 ? "No handoffs found." : all.map((h) => `${h.id.slice(0, 8)} ${h.status} ${h.work.title}`).join("\n"),
  );
}

// -------------------------------------------------------------- handoff_fork

export function handoffFork(ctx: ToolContext, id: string, label: string): McpToolResult<Handoff> {
  const blocked = guard<Handoff>(ctx);
  if (blocked) return blocked;
  try {
    const child = createFork(ctx.store, id, label);
    return ok(child, `Forked ${id.slice(0, 8)} -> ${child.id.slice(0, 8)} [${label}]`);
  } catch (e) {
    if (e instanceof HandoffNotFoundError) return fail(e.message, "NOT_FOUND");
    throw e;
  }
}

// ------------------------------------------------------------- handoff_merge

export function handoffMerge(
  ctx: ToolContext,
  parentIds: string[],
  resolution: { objective: string; current_state: string; decision: string; title?: string },
): McpToolResult<Handoff> {
  const blocked = guard<Handoff>(ctx);
  if (blocked) return blocked;
  try {
    const merged = createMerge(ctx.store, parentIds, {
      title: resolution.title ?? ctx.store.loadOrThrow(parentIds[0]!).work.title,
      objective: resolution.objective,
      current_state: resolution.current_state,
      decision: resolution.decision,
    });
    return ok(merged, `Merged ${parentIds.length} handoff(s) -> ${merged.id.slice(0, 8)}`);
  } catch (e) {
    if (e instanceof MergeConflictError) {
      return fail(
        `${e.conflicts.length} conflicting decision(s) require an explicit resolution`,
        "CONFLICT",
        { conflicts: e.conflicts },
      );
    }
    if (e instanceof HandoffNotFoundError) return fail(e.message, "NOT_FOUND");
    if ((e as { message: string }).message.includes("two or more")) {
      return fail((e as { message: string }).message, "USER");
    }
    throw e;
  }
}

// ------------------------------------------------------------ handoff_detect

export function handoffDetect(ctx: ToolContext, signals: Partial<DetectorSignals>): McpToolResult {
  const blocked = guard(ctx);
  if (blocked) return blocked;
  const state = loadDetectorState(ctx.rootDir);
  const result = evaluateEvent(
    { harness: "mcp", signals: { ...nullSignals(), ...signals } },
    ctx.config.detector,
    state.last_prompt_at,
    state.last_pressure,
  );
  if (result.recommend && !result.suppress) {
    saveDetectorState(ctx.rootDir, {
      ...state,
      last_prompt_at: new Date().toISOString(),
      last_pressure: result.pressure,
    });
  }
  return ok(
    result,
    `pressure ${result.pressure.toFixed(2)} · action ${result.recommendedAction}${result.suppress ? ` (suppressed: ${result.suppressReason})` : ""}`,
  );
}

// ---------------------------------------------------------------- session id

export function setSessionId(ctx: ToolContext, rawSessionId: string | null): McpToolResult {
  const opaque = rawSessionId ? opaqueSessionId(rawSessionId, ctx.config.policy.hashSessionIds) : null;
  saveDetectorState(ctx.rootDir, { ...loadDetectorState(ctx.rootDir), session_id: opaque });
  return ok({ session_id: opaque }, opaque ? `Session ${opaque} recorded.` : "Session cleared.");
}

// ------------------------------------------------------------------- lineage

export function lineage(ctx: ToolContext): McpToolResult {
  const blocked = guard(ctx);
  if (blocked) return blocked;
  const graph = buildGraph(ctx.store);
  return ok({ nodes: graph }, renderLineageAscii(graph));
}

export { auditHandoff };
