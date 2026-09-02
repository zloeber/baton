/**
 * Policy engine (spec §16).
 *
 * - Default scope is the project root; out-of-root references are violations
 *   unless explicitly allowlisted in config `policy.allowedRoots`.
 * - Redaction removes values and records only the field path + reason —
 *   never the removed value.
 * - No transcript-bearing field is accepted in v0.1.
 */
import { isInsideRoot } from "./paths.js";
import { Handoff } from "./schema.js";
import { createHash } from "node:crypto";

export const REDACTED = "[REDACTED]";

/** Field names that smuggle raw conversation content; rejected in v0.1. */
export const TRANSCRIPT_FIELDS = [
  "transcript",
  "full_transcript",
  "messages",
  "conversation",
  "chat_history",
  "turns",
];

export interface Redaction {
  field: string;
  reason: string;
  replacement: string;
}

/**
 * Compile config regex strings. JS RegExp lacks inline flags, so a leading
 * `(?i)` is translated into the `i` flag. Invalid patterns are skipped and
 * reported so policy failures stay explicit.
 */
export function compileSecretPatterns(
  patterns: string[],
): { regexes: RegExp[]; invalid: string[] } {
  const regexes: RegExp[] = [];
  const invalid: string[] = [];
  for (const p of patterns) {
    try {
      if (p.startsWith("(?i)")) {
        regexes.push(new RegExp(p.slice(4), "gi"));
      } else {
        regexes.push(new RegExp(p, "g"));
      }
    } catch {
      invalid.push(p);
    }
  }
  return { regexes, invalid };
}

export function findSecretMatches(value: string, regexes: RegExp[]): string[] {
  const hits: string[] = [];
  for (const rx of regexes) {
    rx.lastIndex = 0;
    const m = rx.exec(value);
    if (m) hits.push(m[0]);
  }
  return hits;
}

interface WalkAcc {
  redactions: Redaction[];
  regexes: RegExp[];
}

function redactString(path: string, value: string, acc: WalkAcc): string {
  let out = value;
  let hit = false;
  for (const rx of acc.regexes) {
    rx.lastIndex = 0;
    if (rx.test(out)) {
      hit = true;
      rx.lastIndex = 0;
      out = out.replace(rx, () => REDACTED);
    }
  }
  if (hit) {
    acc.redactions.push({
      field: path,
      reason: "matched secret policy",
      replacement: REDACTED,
    });
  }
  return out;
}

function walk(path: string, value: unknown, acc: WalkAcc): unknown {
  if (typeof value === "string") return redactString(path, value, acc);
  if (Array.isArray(value)) {
    return value.map((v, i) => walk(`${path}[${i}]`, v, acc));
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      // Never rewrite the redaction ledger itself (it stores no secret values).
      if (path === "" && k === "redactions") {
        out[k] = v;
        continue;
      }
      out[k] = walk(path === "" ? k : `${path}.${k}`, v, acc);
    }
    return out;
  }
  return value;
}

/**
 * Deeply redact secret-like values in a handoff-shaped document. Returns the
 * redacted document plus the ledger of field paths that changed.
 */
export function redactDocument<T>(doc: T, patterns: string[]): { doc: T; redactions: Redaction[] } {
  const { regexes } = compileSecretPatterns(patterns);
  const acc: WalkAcc = { redactions: [], regexes };
  const out = walk("", doc, acc);
  return { doc: out as T, redactions: acc.redactions };
}

export interface TranscriptViolation {
  field: string;
}

/** Find transcript-bearing fields anywhere in a parsed record. */
export function findTranscriptFields(value: unknown, base = ""): TranscriptViolation[] {
  const out: TranscriptViolation[] = [];
  if (Array.isArray(value)) {
    value.forEach((v, i) => out.push(...findTranscriptFields(v, `${base}[${i}]`)));
  } else if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const p = base === "" ? k : `${base}.${k}`;
      if (TRANSCRIPT_FIELDS.includes(k)) out.push({ field: p });
      out.push(...findTranscriptFields(v, p));
    }
  }
  return out;
}

export interface PathViolation {
  field: string;
  path: string;
  reason: "outside-root" | "traversal";
}

/**
 * Validate project-relative artifact/evidence paths stay inside root
 * (or an explicitly configured allowed root).
 */
export function checkPathContainment(
  rootDir: string,
  entries: { field: string; path: string }[],
  allowedRoots: string[] = [],
): PathViolation[] {
  const violations: PathViolation[] = [];
  const roots = [rootDir, ...allowedRoots];
  for (const e of entries) {
    if (e.path.includes("..")) {
      violations.push({ field: e.field, path: e.path, reason: "traversal" });
      continue;
    }
    const ok = roots.some((r) => isInsideRoot(r, e.path));
    if (!ok) violations.push({ field: e.field, path: e.path, reason: "outside-root" });
  }
  return violations;
}

/** Collect project-relative paths referenced by artifacts and file evidence. */
export function referencedPaths(h: Handoff): { field: string; path: string }[] {
  const out: { field: string; path: string }[] = [];
  h.artifacts.forEach((a, i) => out.push({ field: `artifacts[${i}].path`, path: a.path }));
  h.evidence.forEach((e, i) => {
    if (e.type === "file" && e.ref) out.push({ field: `evidence[${i}].ref`, path: e.ref });
  });
  return out;
}

/** Opaque session id: hash externally supplied ids when policy requires. */
export function opaqueSessionId(raw: string, hash: boolean): string {
  if (!hash) return raw;
  const digest = createHash("sha256").update(raw).digest("hex").slice(0, 16);
  return `s-${digest}`;
}

export interface AuditReport {
  project_id: string;
  handoff_id: string;
  field_counts: Record<string, number>;
  redactions: Redaction[];
  external_refs: string[];
  local_paths: string[];
  transcript_fields: string[];
  purge_eligible: boolean;
}

/** `baton audit` backing: enumerate data fields, redactions, ext refs. */
export function auditHandoff(h: Handoff): AuditReport {
  const fieldCounts: Record<string, number> = {
    decisions: h.decisions.length,
    artifacts: h.artifacts.length,
    evidence: h.evidence.length,
    open_items: h.open_items.length,
    risks: h.risks.length,
  };
  const external: string[] = [];
  const local: string[] = [];
  for (const e of h.evidence) {
    if (e.ref) {
      if (/^https?:\/\//.test(e.ref)) external.push(e.ref);
      else if (e.type === "file") local.push(e.ref);
    }
  }
  for (const a of h.artifacts) local.push(a.path);
  return {
    project_id: h.project.id,
    handoff_id: h.id,
    field_counts: fieldCounts,
    redactions: h.redactions,
    external_refs: [...new Set(external)],
    local_paths: [...new Set(local)],
    transcript_fields: findTranscriptFields(h).map((v) => v.field),
    purge_eligible: true,
  };
}
