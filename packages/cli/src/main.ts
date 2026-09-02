#!/usr/bin/env node
/**
 * Threadline CLI (spec §11). All commands support --json with stable output
 * and documented exit codes: 0 ok, 2 user/input, 3 validation, 4 not
 * found/conflict, 5 policy.
 */
import { Command } from "commander";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { configureLogger, logEvent } from "@threadline/core";
import { loadContext, resolveRoot } from "./context.js";
import { SqliteIndex } from "./sqliteIndex.js";
import { exitCodeForError } from "./exitCodes.js";
import * as commands from "./commands.js";
import type { OutputOptions } from "./output.js";

const program = new Command();
program
  .name("threadline")
  .description("Portable continuity for AI-agent work.")
  .version("0.1.0")
  .option("--json", "emit stable machine-readable JSON", false)
  .option("--project <dir>", "project root (defaults to nearest .threadline)");

interface GlobalOpts extends OutputOptions {
  project?: string;
}

function withIndex<T>(ctx: ReturnType<typeof loadContext>, fn: (index: SqliteIndex | null) => T): T {
  let index: SqliteIndex | null = null;
  try {
    index = new SqliteIndex(ctx.rootDir);
  } catch {
    index = null; // graceful degradation: JSON records remain the source of truth
  }
  try {
    return fn(index);
  } finally {
    index?.close();
  }
}

function run(action: () => commands.CommandResult, json: boolean | undefined, eventName?: string): void {
  try {
    configureLogger(join(resolveRoot(program.opts<GlobalOpts>().project), ".threadline", "cache", "log.jsonl"));
    const r = action();
    if (json) process.stdout.write(JSON.stringify(r.payload, null, 2) + "\n");
    else if (r.text !== undefined) process.stdout.write(r.text);
    process.exitCode = r.exitCode;
    if (eventName) {
      // Observability (§17): event name + exit code only; no record bodies.
      logEvent(eventName, { exit: r.exitCode });
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (json) {
      process.stdout.write(JSON.stringify({ error: message }, null, 2) + "\n");
    } else {
      process.stderr.write(`error: ${message}\n`);
    }
    process.exitCode = exitCodeForError(e);
  }
}

// ------------------------------------------------------------------ init
program
  .command("init")
  .description("initialize .threadline in the current project")
  .option("--project-id <id>", "explicit project id")
  .action((opts: { projectId?: string }) => {
    const global = program.opts<GlobalOpts>();
    run(() => commands.cmdInit(loadContext(global.project), opts.projectId), global.json, "init");
  });

// --------------------------------------------------------------- session
program
  .command("session")
  .description("session-scoped operations")
  .addCommand(
    new Command("begin")
      .description("record session metadata allowed by policy")
      .option("--harness <name>", "harness name", "generic")
      .option("--session-id <opaque-id>", "externally supplied session id (hashed per policy)")
      .action((opts: { harness: string; sessionId?: string }) => {
        const global = program.opts<GlobalOpts>();
        const ctx = loadContext(global.project);
        run(
          () => withIndex(ctx, (index) => commands.cmdSessionBegin(ctx, opts, index)),
          global.json,
        );
      }),
  );

// ------------------------------------------------------------ checkpoint
const checkpoint = program.command("checkpoint").description("capture drafts during work");
checkpoint
  .command("create")
  .description("create a draft checkpoint from structured fields")
  .requiredOption("--title <text>")
  .requiredOption("--objective <text>")
  .requiredOption("--current-state <text>")
  .option("--completed <items...>")
  .option("--constraints <items...>")
  .option("--open-item <json...>", "open items as JSON objects")
  .option("--decision <json...>", "decisions as JSON objects")
  .option("--evidence <json...>", "evidence records as JSON objects")
  .option("--artifact <json...>", "artifacts as JSON objects")
  .option("--risk <json...>", "risks as JSON objects")
  .option("--from <id>", "parent handoff id (continuation)")
  .option("--trigger <name>", "manual|threshold|hook|timeout|pre_compaction", "manual")
  .option("--input <json-file>", "read the full checkpoint payload from a JSON file")
  .action((opts: Record<string, string | string[] | undefined>) => {
    const global = program.opts<GlobalOpts>();
    const ctx = loadContext(global.project);
    run(() => {
      const fileInput = opts.input
        ? (JSON.parse(readFileSync(resolve(ctx.rootDir, opts.input as string), "utf8")) as Record<string, unknown>)
        : {};
      const parseAll = <T>(v: string | string[] | undefined): T[] =>
        v === undefined ? [] : (Array.isArray(v) ? v : [v]).map((s) => JSON.parse(s) as T);
      return commands.cmdCheckpointCreate(ctx, {
        title: (fileInput.title as string) ?? (opts.title as string),
        objective: (fileInput.objective as string) ?? (opts.objective as string),
        currentState: (fileInput.currentState as string) ?? (fileInput.current_state as string) ?? (opts.currentState as string),
        completed: (fileInput.completed as string[]) ?? (opts.completed as string[]),
        constraints: (fileInput.constraints as string[]) ?? (opts.constraints as string[]),
        openItems: (fileInput.openItems as never[]) ?? parseAll(opts.openItem),
        decisions: (fileInput.decisions as never[]) ?? parseAll(opts.decision),
        evidence: (fileInput.evidence as never[]) ?? parseAll(opts.evidence),
        artifacts: (fileInput.artifacts as never[]) ?? parseAll(opts.artifact),
        risks: (fileInput.risks as never[]) ?? parseAll(opts.risk),
        from: (fileInput.from as string) ?? (opts.from as string | undefined),
        trigger: (opts.trigger as never) ?? "manual",
      });
    }, global.json);
  });


// --------------------------------------------------------------- handoff
const handoff = program.command("handoff").description("inspect and manage handoffs");

handoff
  .command("prepare")
  .description("prepare a handoff draft with prefilled git/session metadata")
  .option("--from <checkpoint>", "parent checkpoint id")
  .option("--trigger <name>", "manual|threshold|hook", "manual")
  .option("--title <text>")
  .option("--objective <text>")
  .option("--current-state <text>")
  .option("--input <json-file>", "JSON payload to merge into the draft")
  .action((opts: { from?: string; trigger?: "manual" | "threshold" | "hook"; title?: string; objective?: string; currentState?: string; input?: string }) => {
    const global = program.opts<GlobalOpts>();
    const ctx = loadContext(global.project);
    run(() => commands.cmdHandoffPrepare(ctx, opts), global.json);
  });

handoff
  .command("validate <id>")
  .description("run deterministic checks (spec §10)")
  .option("--recheck", "re-run only allowlisted command/test evidence")
  .action((id: string, opts: { recheck?: boolean }) => {
    const global = program.opts<GlobalOpts>();
    const ctx = loadContext(global.project);
    run(() => commands.cmdHandoffValidate(ctx, id, opts), global.json, "handoff_validate");
  });

handoff
  .command("ready <id>")
  .description("promote a validated handoff to ready (immutable afterwards)")
  .option("--accept-warnings <reason>", "acknowledge validation warnings with a reason")
  .action((id: string, opts: { acceptWarnings?: string }) => {
    const global = program.opts<GlobalOpts>();
    const ctx = loadContext(global.project);
    run(() => commands.cmdHandoffReady(ctx, id, opts), global.json, "handoff_ready");
  });

handoff
  .command("list")
  .description("list handoffs")
  .option("--status <status>", "filter by status")
  .option("--work <query>", "filter by title substring")
  .action((opts: { status?: string; work?: string }) => {
    const global = program.opts<GlobalOpts>();
    const ctx = loadContext(global.project);
    run(() => withIndex(ctx, (index) => commands.cmdHandoffList(ctx, opts, index)), global.json);
  });

handoff
  .command("show <id>")
  .description("show a handoff record")
  .option("--format <format>", "json|yaml|md|prompt", "json")
  .action((id: string, opts: { format: string }) => {
    const global = program.opts<GlobalOpts>();
    const ctx = loadContext(global.project);
    const format = opts.format as "json" | "yaml" | "md" | "prompt";
    if (!["json", "yaml", "md", "prompt"].includes(format)) {
      process.stderr.write(`error: unknown format ${opts.format}\n`);
      process.exitCode = 2;
      return;
    }
    run(() => commands.cmdHandoffShow(ctx, id, format), global.json);
  });

// ---------------------------------------------------------------- resume
program
  .command("resume <id>")
  .description("render a resume brief from a handoff")
  .option("--format <format>", "prompt|md|json", "prompt")
  .option("--mark-resumed", "mark the handoff resumed in the index")
  .action((id: string, opts: { format: string; markResumed?: boolean }) => {
    const global = program.opts<GlobalOpts>();
    const ctx = loadContext(global.project);
    const format = opts.format as "prompt" | "md" | "json";
    if (!["prompt", "md", "json"].includes(format)) {
      process.stderr.write(`error: unknown format ${opts.format}\n`);
      process.exitCode = 2;
      return;
    }
    run(
      () =>
        withIndex(ctx, (index) => {
          const r = commands.cmdResume(ctx, id, { ...opts, format: format as "prompt" | "md" | "json" }, index);
          commands.recordMetric(index, "resume");
          if ((r.payload as { stale_reasons: string[] }).stale_reasons.length > 0) {
            commands.recordMetric(index, "resume_stale");
          }
          if (format === "md" && !global.json) {
            // Render the full record as Markdown instead of the prompt brief.
            return { ...r, text: String((r.payload as { markdown: string }).markdown) };
          }
          return r;
        }),
      format === "json" ? true : global.json,
    );
  });

// ------------------------------------------------------------------ fork
program
  .command("fork <id>")
  .description("fork a handoff into an immutable linked child")
  .requiredOption("--label <label>")
  .action((id: string, opts: { label: string }) => {
    const global = program.opts<GlobalOpts>();
    const ctx = loadContext(global.project);
    run(() => commands.cmdFork(ctx, id, opts.label), global.json, "fork");
  });

// ----------------------------------------------------------------- merge
program
  .command("merge <a> <b>")
  .description("merge two handoffs; requires an explicit resolution when decisions conflict")
  .option("--title <text>")
  .option("--resolution-file <path>", "JSON file with objective/current_state/decision")
  .action((a: string, b: string, opts: { title?: string; resolutionFile?: string }) => {
    const global = program.opts<GlobalOpts>();
    const ctx = loadContext(global.project);
    run(() => commands.cmdMerge(ctx, a, b, opts), global.json, "merge");
  });

// ---------------------------------------------------------------- detect
program
  .command("detect")
  .description("score handoff pressure from normalized signals (spec §9)")
  .option("--event <json>", "normalized adapter event JSON")
  .option("--prepare", "create a draft when action is prepare")
  .action((opts: { event?: string; prepare?: boolean }) => {
    const global = program.opts<GlobalOpts>();
    const ctx = loadContext(global.project);
    run(() => withIndex(ctx, (index) => commands.cmdDetect(ctx, opts, index)), global.json, "detect");
  });

// ----------------------------------------------------------------- audit
program
  .command("audit [id]")
  .description("enumerate data fields, redactions, and refs (spec §16)")
  .action((id: string | undefined) => {
    const global = program.opts<GlobalOpts>();
    const ctx = loadContext(global.project);
    run(() => commands.cmdAudit(ctx, id), global.json);
  });

// --------------------------------------------------------------- lineage
program
  .command("lineage")
  .description("show the handoff lineage graph")
  .action(() => {
    const global = program.opts<GlobalOpts>();
    const ctx = loadContext(global.project);
    run(() => commands.cmdLineage(ctx), global.json);
  });

// --------------------------------------------------------------- metrics
program
  .command("metrics")
  .description("show local metrics from the index (no outbound analytics)")
  .option("--local", "explicitly local-only (always the case in v0.1)", false)
  .action((_opts: { local: boolean }) => {
    const global = program.opts<GlobalOpts>();
    const ctx = loadContext(global.project);
    run(() => withIndex(ctx, (index) => commands.cmdMetrics(ctx, index)), global.json);
  });

// ---------------------------------------------------------------- doctor
program
  .command("doctor")
  .description("check project, config, git, index health")
  .action(() => {
    const global = program.opts<GlobalOpts>();
    const ctx = loadContext(global.project);
    run(() => commands.cmdDoctor(ctx), global.json);
  });

// -------------------------------------------------------------------- gc
program
  .command("gc")
  .description("remove rebuildable index/cache only; never canonical records")
  .option("--dry-run")
  .action((opts: { dryRun?: boolean }) => {
    const global = program.opts<GlobalOpts>();
    const ctx = loadContext(global.project);
    run(() => commands.cmdGc(ctx, opts), global.json);
  });

program.parseAsync(process.argv);
