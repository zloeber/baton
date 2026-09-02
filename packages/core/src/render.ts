/**
 * Renderers (spec §11, §5). Structured first, rendered second: canonical data
 * in, vendor-neutral views out. The resume prompt brief is bounded (target
 * ≤1,200 tokens by default) and never embeds secret-bearing values.
 */
import { Handoff } from "./schema.js";
import type { Freshness } from "./schema.js";
import { isFresh, freshnessFrom, freshnessState } from "./freshness.js";

export interface RenderOptions {
  /** Hard character budget for the prompt brief; ~4 chars/token. */
  maxChars?: number;
  /** Include validation/evidence detail sections. */
  verbose?: boolean;
}

const DEFAULT_MAX_CHARS = 4800; // ≈1,200 tokens

function bullets(lines: string[], max: number): string[] {
  if (lines.length === 0) return [];
  const out = lines.slice(0, max).map((l) => `- ${l}`);
  if (lines.length > max) out.push(`- … ${lines.length - max} more (see JSON record)`);
  return out;
}

function section(out: string[], title: string, body: string[]): void {
  const filtered = body.filter((l) => l.trim() !== "");
  if (filtered.length === 0) return;
  out.push(`## ${title}`);
  out.push(...filtered);
  out.push("");
}

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return (
    text.slice(0, maxChars - 60) +
    "\n\n[BRIEF TRUNCATED — run `baton handoff show <id> --format json` for the full record]"
  );
}

/**
 * The vendor-neutral resume brief (§11): objective, current state,
 * non-negotiable constraints, decisions, relevant artifacts, validated
 * evidence, risks, first next action, and a final freshness instruction.
 */
export function renderResumePrompt(h: Handoff, options: RenderOptions = {}): string {
  const maxChars = options.maxChars ?? DEFAULT_MAX_CHARS;
  const out: string[] = [];

  out.push(`# Handoff: ${h.work.title}`);
  out.push("");
  out.push(`Status: ${h.status} · captured ${h.created_at} · id ${h.id}`);
  if (h.lineage.relation !== "root") {
    out.push(
      `Lineage: ${h.lineage.relation}${h.lineage.parents.length > 0 ? ` from ${h.lineage.parents.join(", ")}` : ""}`,
    );
  }
  out.push("");

  section(out, "Objective", [h.work.objective]);
  section(out, "Current state", [h.summary.current_state]);
  if (h.summary.completed.length > 0) {
    section(out, "Completed", bullets(h.summary.completed, 8));
  }
  if (h.summary.in_progress.length > 0) {
    section(out, "In progress", bullets(h.summary.in_progress, 8));
  }
  if (h.summary.discoveries.length > 0) {
    section(out, "Discoveries", bullets(h.summary.discoveries, 8));
  }
  if (h.work.constraints.length > 0) {
    section(out, "Non-negotiable constraints", bullets(h.work.constraints, 8));
  }
  if (h.decisions.length > 0) {
    section(
      out,
      "Decisions",
      bullets(
        h.decisions.map((d) => `${d.id}: ${d.decision}`),
        10,
      ),
    );
  }
  if (h.failed_attempts.length > 0) {
    const avoid = h.failed_attempts.filter((f) => f.avoid_repeating);
    if (avoid.length > 0) {
      section(
        out,
        "Do not retry",
        bullets(
          avoid.map((f) => `${f.id}: ${f.approach}${f.reason ? ` — ${f.reason}` : ""}`),
          8,
        ),
      );
    }
    const contextOnly = h.failed_attempts.filter((f) => !f.avoid_repeating);
    if (contextOnly.length > 0) {
      section(
        out,
        "Failed attempts (context, not forbidden)",
        bullets(
          contextOnly.map((f) => `${f.id}: ${f.approach}${f.reason ? ` — ${f.reason}` : ""}`),
          6,
        ),
      );
    }
  }
  if (h.artifacts.length > 0) {
    section(
      out,
      "Key artifacts",
      bullets(
        h.artifacts.map((a) => `${a.path}${a.description ? ` — ${a.description}` : ""}`),
        10,
      ),
    );
  }
  // Evidence is part of the §11 brief contract ("validated evidence"), not a
  // verbose extra: assertions without support are exactly what Baton exists
  // to prevent. Bounded so large ledgers cannot blow the token budget.
  if (h.evidence.length > 0) {
    section(
      out,
      "Evidence",
      bullets(
        h.evidence.map(
          (e) => `${e.id} (${e.type}${e.result ? `, ${e.result}` : ""}): ${e.claim}`,
        ),
        8,
      ),
    );
  }
  if (h.risks.length > 0) {
    section(out, "Risks", bullets(h.risks.map((r) => `${r.severity}: ${r.description}`), 6));
  }
  const firstOpen = [...h.open_items].sort(
    (a, b) => priorityRank(a.priority) - priorityRank(b.priority),
  )[0];
  if (firstOpen) {
    section(out, "First next action", [
      `${firstOpen.description}${firstOpen.suggested_action ? ` — ${firstOpen.suggested_action}` : ""}`,
    ]);
    const rest = h.open_items.filter((o) => o.id !== firstOpen.id);
    if (rest.length > 0) {
      section(out, "Further open items", bullets(rest.map((o) => o.description), 6));
    }
  } else if (h.summary.completed.length > 0) {
    section(out, "First next action", [
      "Work state is recorded as complete; verify with the definition of done before closing.",
    ]);
  }

  // Freshness guidance is always present (§10, §22.3).
  const stale = isStaleHandoff(h);
  const state = freshnessState(freshnessFrom(h));
  out.push("## Verify freshness");
  out.push(
    state === "stale"
      ? "⚠ STALE: the repository has moved since this handoff was captured. Re-check the artifacts and decisions below before relying on them; do not silently apply stale assumptions."
      : state === "partially_stale"
        ? "⚠ PARTIALLY STALE: artifact content has drifted (repository head unchanged). Re-check the drifted artifacts below before relying on their contents."
        : state === "unknown"
          ? "⚠ FRESHNESS UNKNOWN: this handoff has never been evaluated against the repository. Verify the artifacts and decisions before relying on them."
          : "Confirm the repository state matches this handoff before acting: re-run the checks referenced above, then continue with the first next action.",
  );
  void stale;
  out.push("");

  return truncate(out.join("\n"), maxChars);
}

function priorityRank(p: "high" | "medium" | "low"): number {
  return p === "high" ? 0 : p === "medium" ? 1 : 2;
}

/** A handoff is stale when captured head != current head (§22.3). */
export function isStaleHandoff(h: Handoff): boolean {
  const f = freshnessFrom(h);
  return !isFresh(f);
}

/** Human/agent-readable Markdown rendering of the full record. */
export function renderMarkdown(h: Handoff, options: RenderOptions = {}): string {
  const out: string[] = [];
  out.push(`# ${h.work.title}`);
  out.push("");
  out.push(`- **id**: \`${h.id}\``);
  out.push(`- **status**: ${h.status}${h.flags.length > 0 ? ` (flags: ${h.flags.join(", ")})` : ""}`);
  out.push(`- **created**: ${h.created_at} · **updated**: ${h.updated_at}`);
  out.push(`- **schema**: ${h.schema_version} · **relation**: ${h.lineage.relation}`);
  if (h.lineage.branch_label) out.push(`- **branch**: ${h.lineage.branch_label}`);
  if (h.lineage.parents.length > 0) out.push(`- **parents**: ${h.lineage.parents.join(", ")}`);
  out.push("");
  section(out, "Objective", [h.work.objective]);
  section(out, "Current state", [h.summary.current_state]);
  if (h.summary.why_it_matters) section(out, "Why it matters", [h.summary.why_it_matters]);
  section(out, "Completed", bullets(h.summary.completed, 20));
  if (h.summary.in_progress.length > 0) section(out, "In progress", bullets(h.summary.in_progress, 20));
  if (h.summary.discoveries.length > 0) section(out, "Discoveries", bullets(h.summary.discoveries, 20));
  if (h.work.scope.length > 0) section(out, "Scope", bullets(h.work.scope, 20));
  section(out, "Constraints", bullets(h.work.constraints, 20));
  section(out, "Definition of done", bullets(h.work.definition_of_done, 20));
  if (h.decisions.length > 0) {
    out.push("## Decisions");
    for (const d of h.decisions) {
      out.push(`### ${d.id}: ${d.decision}`);
      if (d.rationale) out.push(d.rationale);
      if (d.alternatives_considered.length > 0) {
        out.push(`_Alternatives considered_: ${d.alternatives_considered.join("; ")}`);
      }
      if (d.evidence_ids.length > 0) out.push(`_Evidence_: ${d.evidence_ids.join(", ")}`);
      out.push("");
    }
  }
  if (h.artifacts.length > 0) {
    out.push("## Artifacts");
    for (const a of h.artifacts) {
      out.push(`- \`${a.path}\` (${a.role})${a.description ? ` — ${a.description}` : ""}`);
    }
    out.push("");
  }
  if (h.evidence.length > 0) {
    out.push("## Evidence");
    for (const e of h.evidence) {
      out.push(
        `- **${e.id}** (${e.type}${e.result ? `, ${e.result}` : ""}): ${e.claim}${e.ref ? ` — \`${e.ref}\`` : ""}`,
      );
    }
    out.push("");
  }
  if (h.failed_attempts.length > 0) {
    out.push("## Failed attempts");
    for (const f of h.failed_attempts) {
      out.push(
        `- **${f.id}**${f.outcome ? ` (${f.outcome})` : ""}: ${f.approach}${f.reason ? ` — ${f.reason}` : ""}${f.avoid_repeating ? " · **avoid repeating**" : ""}`,
      );
      if (f.evidence_ids.length > 0) out.push(`  - evidence: ${f.evidence_ids.join(", ")}`);
    }
    out.push("");
  }
  if (h.open_items.length > 0) {
    out.push("## Open items");
    for (const o of h.open_items) {
      out.push(`- **${o.id}** [${o.priority}] ${o.description}`);
      if (o.suggested_action) out.push(`  - suggested action: ${o.suggested_action}`);
      if (o.acceptance_check) out.push(`  - acceptance: ${o.acceptance_check}`);
    }
    out.push("");
  }
  if (h.risks.length > 0) {
    out.push("## Risks");
    for (const r of h.risks) {
      out.push(`- [${r.severity}] ${r.description}${r.mitigation ? ` — mitigation: ${r.mitigation}` : ""}`);
    }
    out.push("");
  }
  out.push("## Validation");
  out.push(`- status: **${h.validation.status}**${h.validation.validated_at ? ` at ${h.validation.validated_at}` : ""}`);
  for (const c of h.validation.checks) {
    out.push(`  - ${c.name}: ${c.status}${c.detail ? ` — ${c.detail}` : ""}`);
  }
  out.push("");
  if (h.redactions.length > 0) {
    out.push("## Redactions");
    for (const r of h.redactions) {
      out.push(`- \`${r.field}\`: ${r.reason}`);
    }
    out.push("");
  }
  if (h.automation.score !== null || h.automation.reasons.length > 0) {
    out.push("## Automation");
    out.push(`- trigger: ${h.automation.trigger}${h.automation.score !== null ? `, score ${h.automation.score.toFixed(2)}` : ""}`);
    for (const reason of h.automation.reasons) out.push(`- ${reason}`);
    out.push("");
  }
  if (h.flags.includes("invalid") || h.flags.includes("conflicted")) {
    out.push(`> ⚠ Record flagged: ${h.flags.join(", ")}`);
    out.push("");
  }
  void options;
  return out.join("\n");
}

/** Minimal YAML emitter (no dependency): scalars, arrays, flat objects. */
function yamlValue(v: unknown, indent: number): string {
  const pad = "  ".repeat(indent);
  if (v === null || v === undefined) return "null";
  if (typeof v === "boolean" || typeof v === "number") return String(v);
  if (typeof v === "string") {
    if (v === "" || v !== v.trim() || /[\n"\\]/.test(v) || /[:#{}\[\],&*?|>'"%@`]/.test(v) || v.includes("://")) {
      return JSON.stringify(v);
    }
    return v;
  }
  if (Array.isArray(v)) {
    if (v.length === 0) return "[]";
    return v
      .map((item) => {
        if (item !== null && typeof item === "object") {
          const nested = yamlValue(item, indent + 1);
          const lines = nested.split("\n").map((l, i) => (i === 0 ? l : pad + l));
          return `${pad}- ${lines.join("\n")}`;
        }
        return `${pad}- ${yamlValue(item, indent)}`;
      })
      .join("\n");
  }
  const entries = Object.entries(v as Record<string, unknown>);
  if (entries.length === 0) return "{}";
  return entries
    .map(([k, val]) => {
      if (val !== null && typeof val === "object" && !Array.isArray(val)) {
        return `${pad}${k}:\n${yamlValue(val, indent + 1)}`;
      }
      if (Array.isArray(val) && val.length > 0) {
        return `${pad}${k}:\n${yamlValue(val, indent + 1)}`;
      }
      return `${pad}${k}: ${yamlValue(val, indent)}`;
    })
    .join("\n");
}

export function renderYaml(h: Handoff): string {
  const body = yamlValue(h, 0);
  const topLevel = body
    .split("\n")
    .map((l) => (l.length > 0 ? l : l))
    .join("\n");
  return `${topLevel}\n`;
}

export { type Freshness, isFresh, freshnessFrom, freshnessState };
