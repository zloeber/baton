/**
 * Validation (spec §10). Deterministic, ordered checks producing a report:
 *   1. schema   — version, uuid, enums, required fields, referential integrity
 *   2. policy   — transcript fields, secret-policy violations, path containment
 *   3. artifact — referenced paths exist in root, hashes match
 *   4. repository — captured git state reported, drift is a warning only
 *   5. evidence — well-formed command/test records; never re-run by default
 *   6. actionability — objective + next action / completed state
 *   7. lineage  — parents known; merges need 2+ parents and resolution
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { isAbsolute, join, relative, resolve } from "node:path";
import {
  Handoff,
  HandoffSchema,
  SCHEMA_VERSION,
  checkReadinessRequirements,
} from "./schema.js";
import { isUuid } from "./ids.js";
import { scoreQuality, formatQuality, QualityScore } from "./quality.js";
import {
  compileSecretPatterns,
  findTranscriptFields,
  referencedPaths,
  checkPathContainment,
} from "./policy.js";
import { nowIso } from "./time.js";

export type CheckStatus = "pass" | "warn" | "fail" | "skipped";

export interface ValidationCheckResult {
  name: string;
  status: CheckStatus;
  detail: string;
}

export interface ValidationReport {
  handoff_id: string;
  status: "pass" | "warn" | "fail";
  validated_at: string;
  checks: ValidationCheckResult[];
  can_ready: boolean;
  warnings: string[];
  failures: string[];
  /** Advisory continuity score (§7); never gates the state machine. */
  quality: QualityScore;
}

export interface ValidationOptions {
  /** Absolute paths beyond project root explicitly trusted (config). */
  allowedRoots?: string[];
  /** Git head now, supplied by the platform layer (CLI/MCP). */
  gitHeadNow?: string | null;
  /** Re-run allowlisted command/test evidence (§10.5 --recheck). */
  recheck?: boolean;
  /** Commands allowed to re-run; anything else is skipped. */
  recheckAllowlist?: string[];
  /** Platform callback to run an allowlisted command. Must be provided by CLI. */
  runCommand?: (command: string, cwd: string) => { code: number | null; output: string };
}

export class Validator {
  constructor(
    private readonly rootDir: string,
    private readonly secretPatterns: string[],
    private readonly options: ValidationOptions = {},
  ) {}

  validate(h: Handoff): ValidationReport {
    const checks: ValidationCheckResult[] = [];
    const warnings: string[] = [];
    const failures: string[] = [];

    // 1. Schema
    checks.push(this.checkSchema(h));
    checks.push(this.checkReferentialIntegrity(h));

    // 2. Policy
    checks.push(this.checkTranscriptPolicy(h));
    checks.push(this.checkSecretPolicy(h));
    checks.push(this.checkPathContainment(h));

    // 3. Artifacts
    checks.push(this.checkArtifacts(h));

    // 4. Repository freshness
    checks.push(this.checkRepositoryFreshness(h));

    // 5. Evidence well-formedness (structural; never re-run by default)
    checks.push(this.checkEvidence(h));

    // 6. Actionability
    checks.push(this.checkActionability(h));

    // 7. Lineage
    checks.push(this.checkLineage(h));

    // 8. Quality (advisory; deterministic continuity score, never a gate)
    const quality = scoreQuality(h);
    checks.push({ name: "quality", status: "pass", detail: formatQuality(quality) });

    for (const c of checks) {
      if (c.status === "fail") failures.push(`${c.name}: ${c.detail}`);
      if (c.status === "warn") warnings.push(`${c.name}: ${c.detail}`);
    }

    const hasFail = failures.length > 0;
    const hasWarn = warnings.length > 0;
    const status: ValidationReport["status"] = hasFail ? "fail" : hasWarn ? "warn" : "pass";
    const readyProblems = checkReadinessRequirements(h);
    const canReady = !hasFail && readyProblems.length === 0;
    return {
      handoff_id: h.id,
      status,
      validated_at: nowIso(),
      checks,
      can_ready: canReady,
      warnings,
      failures,
      quality,
    };
  }

  private checkSchema(h: Handoff): ValidationCheckResult {
    const problems: string[] = [];
    if (h.schema_version !== SCHEMA_VERSION) {
      problems.push(`schema_version ${h.schema_version} != ${SCHEMA_VERSION}`);
    }
    if (!isUuid(h.id)) problems.push("id is not a valid uuid");
    const reparse = HandoffSchema.safeParse(h);
    if (!reparse.success) {
      problems.push("record fails canonical schema parse");
    }
    if (problems.length === 0) {
      return { name: "schema", status: "pass", detail: "" };
    }
    return { name: "schema", status: "fail", detail: problems.join("; ") };
  }

  private checkReferentialIntegrity(h: Handoff): ValidationCheckResult {
    const evidenceIds = new Set(h.evidence.map((e) => e.id));
    const problems: string[] = [];
    for (const d of h.decisions) {
      for (const eid of d.evidence_ids) {
        if (!evidenceIds.has(eid)) problems.push(`decision ${d.id} references missing evidence ${eid}`);
      }
    }
    for (const f of h.failed_attempts) {
      for (const eid of f.evidence_ids) {
        if (!evidenceIds.has(eid)) problems.push(`failed attempt ${f.id} references missing evidence ${eid}`);
      }
    }
    for (const o of h.open_items) {
      for (const b of o.blocked_by) {
        if (!h.open_items.some((x) => x.id === b)) {
          problems.push(`open item ${o.id} blocked_by unknown item ${b}`);
        }
      }
    }
    if (h.lineage.relation === "merge" && h.lineage.parents.length < 2) {
      problems.push("merge lineage requires at least two parents");
    }
    if (problems.length === 0) return { name: "references", status: "pass", detail: "" };
    return { name: "references", status: "fail", detail: problems.join("; ") };
  }

  private checkTranscriptPolicy(h: Handoff): ValidationCheckResult {
    const hits = findTranscriptFields(h);
    if (hits.length === 0) return { name: "policy.transcript", status: "pass", detail: "" };
    return {
      name: "policy.transcript",
      status: "fail",
      detail: `transcript-bearing fields are not allowed in v0.1: ${hits.map((x) => x.field).join(", ")}`,
    };
  }

  private checkSecretPolicy(h: Handoff): ValidationCheckResult {
    const { regexes, invalid } = compileSecretPatterns(this.secretPatterns);
    const problems: string[] = [];
    const patternWarnings = invalid;
    const scan = (value: unknown, path: string): void => {
      if (typeof value === "string") {
        for (const rx of regexes) {
          rx.lastIndex = 0;
          if (rx.test(value)) {
            problems.push(`secret-like value at ${path} must be redacted before ready`);
            break;
          }
        }
      } else if (Array.isArray(value)) {
        value.forEach((v, i) => scan(v, `${path}[${i}]`));
      } else if (value !== null && typeof value === "object") {
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
          if (path === "" && k === "redactions") continue;
          scan(v, path === "" ? k : `${path}.${k}`);
        }
      }
    };
    scan(h, "");
    if (problems.length === 0 && patternWarnings.length > 0) {
      return {
        name: "policy.secrets",
        status: "warn",
        detail: `invalid secret patterns skipped: ${patternWarnings.join(", ")}`,
      };
    }
    if (problems.length === 0) return { name: "policy.secrets", status: "pass", detail: "no secret-like values" };
    return { name: "policy.secrets", status: "fail", detail: problems.join("; ") };
  }

  private checkPathContainment(h: Handoff): ValidationCheckResult {
    const refs = referencedPaths(h);
    const violations = checkPathContainment(this.rootDir, refs, this.options.allowedRoots ?? []);
    if (violations.length === 0) return { name: "policy.paths", status: "pass", detail: "" };
    return {
      name: "policy.paths",
      status: "fail",
      detail: violations
        .map((v) => `${v.field} ${v.path} (${v.reason})`)
        .join("; "),
    };
  }

  private checkArtifacts(h: Handoff): ValidationCheckResult {
    const problems: string[] = [];
    const warnOnly: string[] = [];
    for (let i = 0; i < h.artifacts.length; i++) {
      const a = h.artifacts[i]!;
      const abs = resolve(this.rootDir, a.path);
      const rel = relative(this.rootDir, abs);
      if (rel.startsWith("..") || isAbsolute(rel)) {
        continue; // already failed containment
      }
      if (!existsSync(abs)) {
        problems.push(`artifacts[${i}] ${a.path} does not exist`);
        continue;
      }
      if (statSync(abs).isDirectory()) {
        warnOnly.push(`artifacts[${i}] ${a.path} is a directory; hash check skipped`);
        continue;
      }
      if (a.content_hash) {
        const actual = `sha256:${createHash("sha256").update(readFileSync(abs)).digest("hex")}`;
        if (actual !== a.content_hash) {
          problems.push(`artifacts[${i}] ${a.path} hash mismatch (expected ${a.content_hash}, got ${actual})`);
        }
      }
    }
    if (problems.length === 0 && warnOnly.length === 0) {
      return { name: "artifacts", status: "pass", detail: h.artifacts.length === 0 ? "no artifacts referenced" : `${h.artifacts.length} artifact(s) verified` };
    }
    if (problems.length > 0) return { name: "artifacts", status: "fail", detail: problems.join("; ") };
    return { name: "artifacts", status: "warn", detail: warnOnly.join("; ") };
  }

  private checkRepositoryFreshness(h: Handoff): ValidationCheckResult {
    const captured = h.project.repository?.head ?? null;
    const now = this.options.gitHeadNow ?? null;
    if (captured === null && now === null) {
      return { name: "repository", status: "pass", detail: "no git state captured" };
    }
    if (captured !== null && now !== null && captured !== now) {
      return {
        name: "repository",
        status: "warn",
        detail: `git head moved since capture (${captured} -> ${now}); not a validation failure per §10.4`,
      };
    }
    return { name: "repository", status: "pass", detail: `head ${captured ?? now}` };
  }

  private checkEvidence(h: Handoff): ValidationCheckResult {
    const problems: string[] = [];
    const skipped: string[] = [];
    for (let i = 0; i < h.evidence.length; i++) {
      const e = h.evidence[i]!;
      if ((e.type === "command" || e.type === "test") && e.ref) {
        if (this.options.recheck) {
          const allow = this.options.recheckAllowlist ?? [];
          const allowed = allow.some((pattern) => e.ref !== null && e.ref.startsWith(pattern));
          if (allowed && this.options.runCommand) {
            const r = this.options.runCommand(e.ref, this.rootDir);
            if (r.code !== 0) {
              problems.push(`evidence ${e.id} recheck failed (exit ${r.code})`);
            }
          } else {
            skipped.push(`${e.id} not allowlisted for recheck`);
          }
        }
        if (e.digest !== null && e.digest !== undefined && !/^sha256:[0-9a-f]{64}$/.test(e.digest)) {
          problems.push(`evidence ${e.id} digest must look like sha256:<hex>`);
        }
      }
      if (e.type === "commit" && e.ref !== null && !/^[0-9a-f]{7,40}$/.test(e.ref)) {
        problems.push(`evidence ${e.id} commit ref must be a git sha`);
      }
      if (e.type === "url" && e.ref !== null && !/^https?:\/\//.test(e.ref)) {
        problems.push(`evidence ${e.id} url ref must start with http(s)://`);
      }
    }
    if (problems.length > 0) return { name: "evidence", status: "fail", detail: problems.join("; ") };
    if (skipped.length > 0) {
      return { name: "evidence", status: "warn", detail: `recheck skipped (not allowlisted): ${skipped.join(", ")}` };
    }
    return { name: "evidence", status: "pass", detail: "evidence records well-formed" };
  }

  private checkActionability(h: Handoff): ValidationCheckResult {
    if (!h.work.objective || h.work.objective.trim() === "") {
      return { name: "actionability", status: "fail", detail: "objective is required" };
    }
    const hasActionableOpen = h.open_items.some((o) => o.suggested_action);
    const complete = h.open_items.length === 0 && h.summary.completed.length > 0;
    if (!hasActionableOpen && !complete) {
      return {
        name: "actionability",
        status: "warn",
        detail: "no open item with suggested_action and no completed state; resume may be ambiguous",
      };
    }
    return { name: "actionability", status: "pass", detail: "" };
  }

  private checkLineage(h: Handoff): ValidationCheckResult {
    const problems: string[] = [];
    if (h.lineage.relation !== "root" && h.lineage.parents.length === 0) {
      problems.push(`relation ${h.lineage.relation} requires at least one parent`);
    }
    if (h.lineage.relation === "merge" && h.lineage.parents.length < 2) {
      problems.push("merge requires two or more parents");
    }
    if (problems.length === 0) return { name: "lineage", status: "pass", detail: "" };
    return { name: "lineage", status: "fail", detail: problems.join("; ") };
  }
}

export { Validator as default };
