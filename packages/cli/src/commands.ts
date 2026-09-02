/**
 * Command implementations (spec §11). Pure-ish: each returns a payload for
 * --json and a text view; main.ts maps them onto process exit.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import {
  checkReadinessRequirements,
  Config,
  Handoff,
  MergeConflictError,
  resolveBatonDir,
  ProjectStore,
  ValidationReport,
  Validator,
  auditHandoff,
  buildGraph,
  captureGitInfo,
  createFork,
  createMerge,
  computeFreshness,
  defaultConfig,
  detectLegacyProject,
  DetectorSignals,
  migrateLegacyProject,
  planLegacyMigration,
  evaluateEvent,
  initProject,
  isInitialized,
  loadDetectorState,
  nullSignals,
  opaqueSessionId,
  redactDocument,
  referencedPaths,
  renderLineageAscii,
  renderMarkdown,
  renderResumePrompt,
  renderYaml,
  saveDetectorState,
  saveConfig,
  supersedePredecessors,
  transitionHandoff,
} from "@baton/core";
import { AppContext, CliError, requireInitialized } from "./context.js";
import { SqliteIndex } from "./sqliteIndex.js";

export interface CommandResult {
  payload: unknown;
  text?: string;
  exitCode: number;
}

function short(h: Handoff) {
  return {
    id: h.id,
    status: h.status,
    title: h.work.title,
    created_at: h.created_at,
    relation: h.lineage.relation,
    branch_label: h.lineage.branch_label,
  };
}

// ---------------------------------------------------------------- init

export function cmdInit(
  ctx: AppContext,
  projectId?: string,
  opts: { migrateLegacy?: boolean } = {},
): CommandResult {
  // Consent-gated legacy migration (spec-hermes-adapter §7.2): only with the
  // explicit flag, never automatically.
  let migration: ReturnType<typeof migrateLegacyProject> | null = null;
  if (opts.migrateLegacy && detectLegacyProject(ctx.rootDir)) {
    migration = migrateLegacyProject(ctx.rootDir);
  }
  const result = initProject(ctx.rootDir, projectId);
  // Stamp the computed project id when the caller did not supply one.
  const cfg = defaultConfig();
  const loaded = JSON.parse(readFileSync(result.configPath, "utf8")) as Config;
  if (loaded.project_id === "sha256:pending" || loaded.project_id === "") {
    loaded.project_id = projectId ?? ctx.store.projectInfo().id;
    saveConfig(ctx.rootDir, loaded);
  }
  void cfg;
  const migrationText =
    migration === null
      ? ""
      : migration.migrated
        ? `  migrated: .threadline/ -> .baton/ (${migration.rewritten.length} record(s) re-id'd)\n`
        : "";
  const legacyHint =
    !opts.migrateLegacy && detectLegacyProject(ctx.rootDir)
      ? `  note:     legacy .threadline/ detected — run "baton migrate" to move it to .baton/\n`
      : "";
  return {
    payload: { ...result, migration },
    text:
      `Initialized Baton in ${ctx.rootDir}\n` +
      `  created:  ${result.created.join(", ")}\n` +
      (result.existing.length > 0 ? `  existing: ${result.existing.join(", ")}\n` : "") +
      migrationText +
      legacyHint,
    exitCode: 0,
  };
}

// ------------------------------------------------------------ migrate

export function cmdMigrate(ctx: AppContext, opts: { dryRun?: boolean }): CommandResult {
  if (!detectLegacyProject(ctx.rootDir)) {
    return {
      payload: { migrated: false, reason: "no legacy directory" },
      text: `No legacy .threadline/ directory in ${ctx.rootDir}; nothing to migrate.\n`,
      exitCode: 0,
    };
  }
  if (opts.dryRun) {
    const plan = planLegacyMigration(ctx.rootDir);
    const text =
      `Dry run — migration plan for ${ctx.rootDir}:\n` +
      plan.items.map((i) => `  ${i.action}: ${i.source}/ -> ${i.destination}/`).join("\n") + "\n" +
      (plan.handoffs_to_rewrite.length > 0
        ? `  rewrite $schema in ${plan.handoffs_to_rewrite.length} record(s):\n    ${plan.handoffs_to_rewrite.join("\n    ")}\n`
        : "") +
      plan.warnings.map((w) => `  warning: ${w}\n`).join("") +
      `Re-run without --dry-run to apply.\n`;
    return { payload: { dry_run: true, plan }, text, exitCode: 0 };
  }
  const result = migrateLegacyProject(ctx.rootDir);
  const text =
    `Migrated legacy Baton state in ${ctx.rootDir}:\n` +
    `  moved:    .threadline/ -> ${result.backup_dir ? ".baton/ (legacy copy kept at .baton.legacy/)" : ".baton/"}\n` +
    `  re-id'd:  ${result.rewritten.length} record(s) now use the baton.dev schema id\n` +
    result.plan.warnings.map((w) => `  warning: ${w}\n`).join("");
  return { payload: result, text, exitCode: 0 };
}

// ------------------------------------------------------------- session

export function cmdSessionBegin(
  ctx: AppContext,
  opts: { harness?: string; sessionId?: string },
  index: SqliteIndex | null,
): CommandResult {
  requireInitialized(ctx);
  const harness = (opts.harness ?? "generic") as Handoff["origin"]["harness"];
  const opaque = opts.sessionId
    ? opaqueSessionId(opts.sessionId, ctx.config.policy.hashSessionIds)
    : null;
  if (index) {
    index.setDetectorState({ session_id: opaque });
  } else {
    const state = loadDetectorState(ctx.rootDir);
    saveDetectorState(ctx.rootDir, { ...state, session_id: opaque });
  }
  const payload = { session: { harness, session_id: opaque } };
  return {
    payload,
    text: `Session begun (harness: ${harness}${opaque ? `, session ${opaque}` : ""}).\n`,
    exitCode: 0,
  };
}

// ---------------------------------------------------------- checkpoint

export interface CheckpointInput {
  title?: string;
  objective?: string;
  currentState?: string;
  completed?: string[];
  constraints?: string[];
  definitionOfDone?: string[];
  openItems?: {
    id: string;
    priority: "high" | "medium" | "low";
    description: string;
    suggested_action?: string | null;
    acceptance_check?: string | null;
  }[];
  decisions?: {
    id: string;
    decision: string;
    rationale?: string | null;
    alternatives_considered?: string[];
    evidence_ids?: string[];
    made_at?: string;
  }[];
  evidence?: {
    id: string;
    type: "command" | "test" | "file" | "commit" | "url" | "human";
    claim: string;
    ref?: string | null;
    result?: string | null;
  }[];
  artifacts?: { path: string; role: "modified" | "created" | "read" | "generated"; description?: string | null }[];
  risks?: { description: string; severity: "high" | "medium" | "low"; mitigation?: string | null }[];
  from?: string;
  trigger?: "manual" | "threshold" | "hook" | "timeout" | "pre_compaction";
  score?: number | null;
  reasons?: string[];
}

export function cmdCheckpointCreate(
  ctx: AppContext,
  input: CheckpointInput,
  now: Date = new Date(),
): CommandResult {
  requireInitialized(ctx);
  const git = captureGitInfo(ctx.rootDir);
  const originSessionId = loadDetectorState(ctx.rootDir).session_id;
  let created: Handoff;
  try {
    created = ctx.store.create(
      withRedaction(
        ctx,
        {
          project: {
            id: ctx.store.projectInfo().id,
            root_hint: ".",
            repository: git.vcs === "git" ? git : null,
          },
          origin: {
            harness: "generic",
            adapter_version: "0.1.0",
            session_id: originSessionId,
            model: null,
            actor: null,
          },
          work: {
            title: input.title,
            objective: input.objective,
            scope: [],
            constraints: input.constraints ?? [],
            definition_of_done: input.definitionOfDone ?? [],
          },
          summary: {
            completed: input.completed ?? [],
            current_state: input.currentState,
            why_it_matters: null,
          },
          decisions: (input.decisions ?? []).map((d, i) => ({
            id: d.id ?? `D-${String(i + 1).padStart(3, "0")}`,
            decision: d.decision,
            rationale: d.rationale ?? null,
            alternatives_considered: d.alternatives_considered ?? [],
            evidence_ids: d.evidence_ids ?? [],
            made_at: d.made_at ?? now.toISOString(),
          })),
          artifacts: (input.artifacts ?? []).map((a) => ({
            path: a.path,
            role: a.role,
            description: a.description ?? null,
            revision: git.head ? `git:${git.head}` : null,
            content_hash: null,
            sensitive: false,
          })),
          evidence: (input.evidence ?? []).map((e, i) => ({
            id: e.id ?? `E-${String(i + 1).padStart(3, "0")}`,
            type: e.type,
            claim: e.claim,
            ref: e.ref ?? null,
            captured_at: now.toISOString(),
            result: e.result ?? null,
            digest: null,
          })),
          open_items: (input.openItems ?? []).map((o, i) => ({
            id: o.id ?? `O-${String(i + 1).padStart(3, "0")}`,
            priority: o.priority,
            description: o.description,
            suggested_action: o.suggested_action ?? null,
            blocked_by: [],
            acceptance_check: o.acceptance_check ?? null,
          })),
          risks: (input.risks ?? []).map((r) => ({
            description: r.description,
            severity: r.severity,
            mitigation: r.mitigation ?? null,
          })),
          lineage: input.from
            ? { parents: [ctx.store.loadOrThrow(input.from).id], relation: "continue", branch_label: null, merge_basis: [] }
            : { parents: [], relation: "root", branch_label: null, merge_basis: [] },
          automation: {
            trigger: input.trigger ?? "manual",
            score: input.score ?? null,
            reasons: input.reasons ?? [],
          },
        },
        now,
      ),
      now,
    );
  } catch (e) {
    if ((e as { code?: string })?.code === "POLICY") throw e;
    throw e;
  }
  return {
    payload: { handoff: created },
    text: `Created draft ${created.id} (${created.status}) — ${created.work.title}\n`,
    exitCode: 0,
  };
}

/** Apply secret redaction before persisting; policy failures are explicit. */
function withRedaction(ctx: AppContext, candidate: Record<string, unknown>, now: Date): Record<string, unknown> {
  const { doc, redactions } = redactDocument(candidate, ctx.config.policy.secretPatterns);
  return { ...doc, redactions };
}

// ------------------------------------------------------------- prepare

export function cmdHandoffPrepare(
  ctx: AppContext,
  opts: { from?: string; trigger?: "manual" | "threshold" | "hook"; title?: string; objective?: string; currentState?: string; input?: string },
  now: Date = new Date(),
): CommandResult {
  requireInitialized(ctx);
  const input: Partial<CheckpointInput> = opts.input
    ? (JSON.parse(readFileSync(resolve(ctx.rootDir, opts.input), "utf8")) as Partial<CheckpointInput>)
    : {};
  const git = captureGitInfo(ctx.rootDir);
  const from = opts.from ?? input.from;
  const parent = from ? ctx.store.loadOrThrow(from) : null;
  const changedFiles = git.dirty
    ? listChangedFiles(ctx.rootDir)
    : [];
  const title = opts.title ?? input.title ?? parent?.work.title ?? "Untitled handoff (complete this)";
  const objective = opts.objective ?? input.objective ?? parent?.work.objective ?? "TODO: describe the measurable desired outcome";
  const currentState = opts.currentState ?? input.currentState ?? parent?.summary.current_state ?? "TODO: describe the current state";
  return cmdCheckpointCreate(
    ctx,
    {
      title,
      objective,
      currentState,
      constraints: parent?.work.constraints ?? input.constraints ?? [],
      definitionOfDone: parent?.work.definition_of_done ?? input.definitionOfDone ?? [],
      completed: input.completed ?? [],
      openItems: input.openItems ?? [
        {
          id: "O-001",
          priority: "high",
          description: "TODO: first next action for the resuming session",
          suggested_action: "TODO: concrete first step",
          acceptance_check: null,
        },
      ],
      artifacts: changedFiles.slice(0, 20).map((p) => ({ path: p, role: "modified" as const, description: null })),
      from: parent?.id,
      trigger: opts.trigger ?? "manual",
    },
    now,
  );
}

function listChangedFiles(rootDir: string): string[] {
  try {
    const out = execFileSync("git", ["status", "--porcelain"], {
      cwd: rootDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out
      .split("\n")
      .map((l) => l.slice(3).trim().replace(/^"|"$/g, ""))
      .filter((l) => l !== "")
      .filter((p) => {
        const abs = resolve(rootDir, p);
        try {
          return statSync(abs).isFile();
        } catch {
          return false;
        }
      })
      .filter((p) => !p.startsWith(".baton/") && !p.startsWith(".threadline/"));
  } catch {
    return [];
  }
}

// ------------------------------------------------------------ validate

export function cmdHandoffValidate(
  ctx: AppContext,
  id: string,
  opts: { recheck?: boolean; json?: boolean },
): CommandResult {
  requireInitialized(ctx);
  const h = ctx.store.loadOrThrow(id);
  const validator = new Validator(ctx.rootDir, ctx.config.policy.secretPatterns, {
    allowedRoots: ctx.config.policy.allowedRoots,
    gitHeadNow: captureGitInfo(ctx.rootDir).head,
    recheck: opts.recheck,
    recheckAllowlist: ((ctx.config as Config & { recheckAllowlist?: string[] }).recheckAllowlist ?? []),
    runCommand: (command, cwd) => {
      try {
        const out = execFileSync("sh", ["-c", command], { cwd, encoding: "utf8" });
        return { code: 0, output: out };
      } catch (e) {
        const err = e as { status?: number };
        return { code: err.status ?? 1, output: "" };
      }
    },
  });
  const report = validator.validate(h);
  // Persist the validation block onto the record (state machine guards legality).
  if (report.status === "fail") {
    if (!h.flags.includes("invalid")) {
      ctx.store.update({ ...h, flags: [...h.flags, "invalid" as const] });
    }
  } else {
    const nextStatus = h.status === "draft" ? "validated" : h.status;
    ctx.store.update({
      ...transitionHandoff(h, nextStatus),
      validation: {
        status: report.status,
        validated_at: report.validated_at,
        checks: report.checks as unknown as typeof h.validation.checks,
        freshness: h.validation.freshness,
      },
    });
  }
  const text =
    `${report.status.toUpperCase()} ${h.id}\n` +
    report.checks
      .map((c: { status: string; name: string; detail: string }) => `  ${c.status.padEnd(7)} ${c.name}${c.detail ? ` — ${c.detail}` : ""}`)
      .join("\n") +
    "\n";
  return { payload: report, text, exitCode: report.status === "fail" ? 3 : 0 };
}

// --------------------------------------------------------------- ready

export function cmdHandoffReady(
  ctx: AppContext,
  id: string,
  opts: { acceptWarnings?: string },
): CommandResult {
  requireInitialized(ctx);
  const h = ctx.store.loadOrThrow(id);
  const validator = new Validator(ctx.rootDir, ctx.config.policy.secretPatterns, {
    allowedRoots: ctx.config.policy.allowedRoots,
    gitHeadNow: captureGitInfo(ctx.rootDir).head,
  });
  const report: ValidationReport = validator.validate(h);
  if (report.status === "fail") {
    throw new CliError(`validation failed; amend before promoting:\n${report.failures.join("\n")}`, "VALIDATION");
  }
  if (report.status === "warn" && !opts.acceptWarnings) {
    throw new CliError(
      `validation has warnings; pass --accept-warnings "<reason>" to promote:\n${report.warnings.join("\n")}`,
      "VALIDATION",
    );
  }
  const problems = checkReadinessRequirements(h);
  if (problems.length > 0) {
    throw new CliError(`cannot become ready:\n${problems.join("\n")}`, "VALIDATION");
  }
  const now = new Date();
  const ready = transitionHandoff(
    {
      ...h,
      flags: report.status === "warn" && opts.acceptWarnings ? h.flags : h.flags.filter((f: string) => f !== "invalid"),
      validation: {
        status: report.status,
        validated_at: report.validated_at,
        checks: report.checks as unknown as typeof h.validation.checks,
        freshness: h.validation.freshness,
      },
    },
    "ready",
    now,
  );
  ctx.store.update(ready);
  return {
    payload: { handoff: ready },
    text: `Ready: ${ready.id}\nResume with: baton resume ${ready.id}\n`,
    exitCode: 0,
  };
}

// ---------------------------------------------------------------- list

export function cmdHandoffList(
  ctx: AppContext,
  opts: { status?: string; work?: string; json?: boolean },
  index: SqliteIndex | null,
): CommandResult {
  requireInitialized(ctx);
  let listings;
  if (index) {
    const rows = index.query({ status: opts.status, work: opts.work });
    listings = rows.map((r) => ({
      id: r.id,
      status: r.status,
      created_at: r.created_at,
      updated_at: r.updated_at,
      title: r.title,
      objective: "",
      relation: r.relation,
      branch_label: null,
      parents: r.parents,
      file: r.file,
    }));
    if (listings.length === 0 && index.counts() && Object.keys(index.counts()).length === 0) {
      listings = filterListings(ctx.store.listings(), opts);
    }
  } else {
    listings = filterListings(ctx.store.listings(), opts);
  }
  const text =
    listings.length === 0
      ? "No handoffs found.\n"
      : listings
          .map(
            (l) =>
              `${l.id.slice(0, 8)}  ${l.status.padEnd(10)} ${l.relation.padEnd(8)} ${l.title}`,
          )
          .join("\n") + "\n";
  return { payload: { handoffs: listings }, text, exitCode: 0 };
}

function filterListings(
  listings: ReturnType<ProjectStore["listings"]>,
  opts: { status?: string; work?: string },
) {
  return listings.filter(
    (l) =>
      (!opts.status || l.status === opts.status) &&
      (!opts.work || l.title.toLowerCase().includes(opts.work.toLowerCase())),
  );
}

// ---------------------------------------------------------------- show

export function cmdHandoffShow(
  ctx: AppContext,
  id: string,
  format: "json" | "yaml" | "md" | "prompt",
): CommandResult {
  requireInitialized(ctx);
  const h = ctx.store.loadOrThrow(id);
  switch (format) {
    case "yaml":
      return { payload: h, text: renderYaml(h), exitCode: 0 };
    case "md":
      return { payload: h, text: renderMarkdown(h), exitCode: 0 };
    case "prompt":
      return { payload: h, text: renderResumePrompt(h), exitCode: 0 };
    default:
      return { payload: h, text: JSON.stringify(h, null, 2) + "\n", exitCode: 0 };
  }
}

// -------------------------------------------------------------- resume

export function cmdResume(
  ctx: AppContext,
  id: string,
  opts: { format?: "prompt" | "md" | "json"; markResumed?: boolean },
  index: SqliteIndex | null,
): CommandResult {
  requireInitialized(ctx);
  const h = ctx.store.loadOrThrow(id);
  const git = captureGitInfo(ctx.rootDir);
  const freshness = computeFreshness(h, ctx.rootDir, git.head);
  const rendered = { ...h, validation: { ...h.validation, freshness } } as Handoff;
  const prompt = renderResumePrompt(rendered);
  const staleReasons: string[] = [];
  if (freshness.git_head_at_capture && freshness.git_head_now && freshness.git_head_at_capture !== freshness.git_head_now) {
    staleReasons.push(
      `git head moved since capture (${freshness.git_head_at_capture} -> ${freshness.git_head_now})`,
    );
  }
  const drifted = (freshness as unknown as { drifted_artifacts?: string[] }).drifted_artifacts;
  if (Array.isArray(drifted)) {
    for (const p of drifted) {
      staleReasons.push(`artifact changed on disk: ${p}`);
    }
  }
  let status = h.status;
  if (opts.markResumed && h.status === "ready") {
    const resumed = transitionHandoff(h, "resumed");
    ctx.store.update(resumed);
    status = "resumed";
  }
  const payload = {
    id: h.id,
    title: h.work.title,
    prompt,
    markdown: renderMarkdown(rendered),
    freshness,
    stale_reasons: staleReasons,
    status,
  };
  const text =
    (staleReasons.length > 0
      ? `⚠ STALE HANDOFF\n${staleReasons.map((r) => `  - ${r}`).join("\n")}\n\n`
      : "") + prompt;
  return { payload, text, exitCode: 0 };
}

// ---------------------------------------------------------------- fork

export function cmdFork(ctx: AppContext, id: string, label: string): CommandResult {
  requireInitialized(ctx);
  const child = createFork(ctx.store, id, label);
  return {
    payload: { handoff: child },
    text: `Forked ${id.slice(0, 8)} -> ${child.id.slice(0, 8)} [${label}]\n`,
    exitCode: 0,
  };
}

// --------------------------------------------------------------- merge

export function cmdMerge(
  ctx: AppContext,
  a: string,
  b: string,
  opts: { title?: string; resolutionFile?: string },
): CommandResult {
  requireInitialized(ctx);
  const resolution = opts.resolutionFile
    ? (JSON.parse(readFileSync(resolve(ctx.rootDir, opts.resolutionFile), "utf8")) as {
        title?: string;
        objective?: string;
        current_state?: string;
        decision?: string;
      })
    : {};
  const first = ctx.store.loadOrThrow(a);
  try {
    const merged = createMerge(ctx.store, [a, b], {
      title: opts.title ?? resolution.title ?? first.work.title,
      objective: resolution.objective ?? first.work.objective,
      current_state: resolution.current_state ?? "Merged state; see resolution decision.",
      decision: resolution.decision ?? "",
    });
    return {
      payload: { handoff: merged },
      text: `Merged ${a.slice(0, 8)} + ${b.slice(0, 8)} -> ${merged.id.slice(0, 8)}\n`,
      exitCode: 0,
    };
  } catch (e) {
    if (e instanceof MergeConflictError) {
      return {
        payload: { error: "merge_conflict", conflicts: e.conflicts },
        text:
          `Merge blocked by ${e.conflicts.length} conflicting decision(s); supply a resolution:\n` +
          e.conflicts
            .map(
              (c) =>
                `  - ${c.positions.map((p) => `${p.handoff_id.slice(0, 8)}/${p.decision_id}: ${p.decision}`).join("  vs  ")}`,
            )
            .join("\n") +
          "\nWrite a resolution JSON file and pass --resolution-file <path>.\n",
        exitCode: 4,
      };
    }
    throw e;
  }
}

// -------------------------------------------------------------- detect

export function cmdDetect(
  ctx: AppContext,
  opts: { event?: string; prepare?: boolean },
  index: SqliteIndex | null,
): CommandResult {
  requireInitialized(ctx);
  const event = opts.event
    ? (JSON.parse(opts.event) as { harness: string; signals?: Partial<DetectorSignals> })
    : { harness: "generic", signals: {} };
  const state = index ? index.getDetectorState() : loadDetectorState(ctx.rootDir);
  const result = evaluateEvent(
    { harness: event.harness, signals: { ...nullSignals(), ...event.signals } },
    ctx.config.detector,
    state.last_prompt_at,
    state.last_pressure,
  );
  let draft: Handoff | null = null;
  const shouldPrepare = opts.prepare === true && result.recommendedAction === "prepare";
  if (shouldPrepare) {
    const r = cmdHandoffPrepare(ctx, { trigger: "threshold", input: undefined });
    draft = (r.payload as { handoff: Handoff }).handoff;
  }
  // Update suppression state: prompt shown unless suppressed.
  if (result.recommend && !result.suppress) {
    const nowIso = new Date().toISOString();
    if (index) index.setDetectorState({ last_prompt_at: nowIso, last_pressure: result.pressure });
    else {
      const s = loadDetectorState(ctx.rootDir);
      saveDetectorState(ctx.rootDir, { ...s, last_prompt_at: nowIso, last_pressure: result.pressure });
    }
  }
  const text =
    (result.suppress ? `Suppressed: ${result.suppressReason}\n` : "") +
    `pressure ${result.pressure.toFixed(2)} · readiness ${result.readiness?.toFixed(2) ?? "n/a"} · ` +
    `action: ${result.recommendedAction}${draft ? ` (draft ${draft.id})` : ""}\n` +
    result.reasons.map((r) => `  - ${r}`).join("\n") +
    "\n" +
    result.inputs.map((i) => `  [${i.used ? "used" : "unused"}] ${i.label}: ${String(i.value)}`).join("\n") +
    "\n";
  return { payload: { ...result, draft }, text, exitCode: 0 };
}

// -------------------------------------------------------------- doctor

export function cmdDoctor(ctx: AppContext): CommandResult {
  const initialized = isInitialized(ctx.rootDir);
  const legacyDetected = detectLegacyProject(ctx.rootDir);
  const broken = initialized ? ctx.store.brokenFiles() : [];
  const git = captureGitInfo(ctx.rootDir);
  let indexOk: boolean | null = null;
  try {
    const index = new SqliteIndex(ctx.rootDir);
    index.rebuild(ctx.store.indexEntries());
    indexOk = true;
    index.close();
  } catch {
    indexOk = false;
  }
  const payload = {
    root: ctx.rootDir,
    initialized,
    legacy_detected: legacyDetected,
    broken_files: broken,
    git,
    sqlite_index: indexOk === null ? "unknown" : indexOk ? "ok" : "unavailable",
    config_valid: initialized,
  };
  const text =
    `Baton doctor\n` +
    `  project root:   ${ctx.rootDir}\n` +
    `  initialized:    ${initialized}\n` +
    `  config:         ${initialized ? "ok" : "missing (run baton init)"}\n` +
    `  git:            ${git.vcs === "git" ? `head ${git.head}${git.dirty ? " (dirty)" : ""}` : "not a git repository"}\n` +
    `  sqlite index:   ${payload.sqlite_index}\n` +
    `  broken records: ${broken.length === 0 ? "none" : broken.map((b) => `${b.file}: ${b.error}`).join("; ")}\n` +
    (legacyDetected
      ? `  legacy dir:     .threadline/ detected — run "baton migrate --dry-run" then "baton migrate"\n`
      : "");
  return { payload, text, exitCode: initialized && broken.length === 0 ? 0 : 2 };
}

// ----------------------------------------------------------------- gc

export function cmdGc(ctx: AppContext, opts: { dryRun?: boolean }): CommandResult {
  requireInitialized(ctx);
  const batonDir = resolveBatonDir(ctx.rootDir);
  const cacheDir = join(batonDir, "cache");
  const indexSqlite = join(batonDir, "index.sqlite");
  const removable: string[] = [];
  if (existsSync(cacheDir)) removable.push(relative(ctx.rootDir, cacheDir));
  if (existsSync(indexSqlite)) removable.push(relative(ctx.rootDir, indexSqlite));
  if (!opts.dryRun) {
    for (const p of removable) rmSync(resolve(ctx.rootDir, p), { recursive: true, force: true });
  }
  return {
    payload: { removed: opts.dryRun ? [] : removable, removable },
    text:
      (opts.dryRun ? "Would remove (dry run): " : "Removed: ") +
      (removable.join(", ") || "nothing") +
      "\nCanonical handoff records are never removed by gc.\n",
    exitCode: 0,
  };
}

// --------------------------------------------------------------- audit

export function cmdAudit(ctx: AppContext, id?: string): CommandResult {
  requireInitialized(ctx);
  const targets = id ? [ctx.store.loadOrThrow(id)] : ctx.store.listAll();
  const reports = targets.map((h) => auditHandoff(h));
  const text =
    reports
      .map(
        (r) =>
          `${r.handoff_id.slice(0, 8)}: ${r.field_counts.decisions} decisions, ${r.field_counts.evidence} evidence, ` +
          `${r.redactions.length} redaction(s), ${r.external_refs.length} external ref(s), ` +
          `${r.local_paths.length} local path(s)`,
      )
      .join("\n") + "\n";
  return { payload: { reports }, text, exitCode: 0 };
}

// -------------------------------------------------------------- lineage

export function cmdLineage(ctx: AppContext): CommandResult {
  requireInitialized(ctx);
  const graph = buildGraph(ctx.store);
  return {
    payload: { nodes: graph },
    text: renderLineageAscii(graph) + "\n",
    exitCode: 0,
  };
}

// ------------------------------------------------------------- metrics

export function cmdMetrics(ctx: AppContext, index: SqliteIndex | null): CommandResult {
  requireInitialized(ctx);
  const metrics = index ? index.metrics() : [];
  return {
    payload: { metrics },
    text:
      metrics.length === 0
        ? "No local metrics recorded yet.\n"
        : metrics.map((m) => `${m.at}  ${m.name}  ${m.value}`).join("\n") + "\n",
    exitCode: 0,
  };
}

/** Record a local metric when an index is available (§17; no outbound). */
export function recordMetric(index: SqliteIndex | null, name: string, value = 1): void {
  try {
    index?.recordMetric(name, value);
  } catch {
    // Metrics must never break commands.
  }
}
