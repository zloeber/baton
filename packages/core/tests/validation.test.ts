import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { Validator, ValidationReport } from "../src/validation.js";
import { HandoffSchema, Handoff } from "../src/schema.js";
import { createHash } from "node:crypto";
import fixture from "../../../tests/fixtures/handoff-ready.json" with { type: "json" };

const base = fixture as unknown as Record<string, unknown>;

let dir: string;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function makeProject(): string {
  dir = mkdtempSync(join(tmpdir(), "baton-valid-"));
  mkdirSync(join(dir, "src/auth"), { recursive: true });
  return dir;
}

function handoff(over: Record<string, unknown> = {}): Handoff {
  return HandoffSchema.parse({ ...base, ...over });
}

function sha256File(content: string): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

const PATTERNS = ["(?i)(api[_-]?key|secret|token)\\s*[:=]\\s*\\S+", "sk-[A-Za-z0-9_-]{20,}"];

describe("Validator", () => {
  it("passes a clean ready fixture with artifact present", () => {
    const root = makeProject();
    writeFileSync(join(root, "src/auth/callback.ts"), "export const ok = true;\n");
    const h = handoff();
    const report = new Validator(root, PATTERNS, { gitHeadNow: "abc123def456" }).validate(h);
    expect(report.status).toBe("pass");
    expect(report.can_ready).toBe(true);
    expect(report.failures).toEqual([]);
  });

  it("fails when a referenced artifact does not exist", () => {
    const root = makeProject();
    const report = new Validator(root, PATTERNS).validate(handoff());
    expect(report.status).toBe("fail");
    expect(report.failures.some((f) => f.includes("artifacts[0]"))).toBe(true);
    expect(report.can_ready).toBe(false);
  });

  it("fails on content hash mismatch", () => {
    const root = makeProject();
    writeFileSync(join(root, "src/auth/callback.ts"), "changed");
    const h = handoff({
      artifacts: [
        {
          path: "src/auth/callback.ts",
          role: "modified",
          description: null,
          revision: null,
          content_hash: sha256File("original"),
          sensitive: false,
        },
      ],
    });
    const report = new Validator(root, PATTERNS).validate(h);
    expect(report.failures.some((f) => f.includes("hash mismatch"))).toBe(true);
  });

  it("warns (not fails) on git head drift (§10.4)", () => {
    const root = makeProject();
    writeFileSync(join(root, "src/auth/callback.ts"), "x");
    const report = new Validator(root, PATTERNS, { gitHeadNow: "ffffff000000" }).validate(handoff());
    expect(report.status).toBe("warn");
    expect(report.warnings.some((w) => w.includes("git head moved"))).toBe(true);
  });

  it("fails on out-of-root artifact paths (§22.8)", () => {
    const root = makeProject();
    const h = handoff({
      artifacts: [
        { path: "../../etc/passwd", role: "read", description: null, revision: null, content_hash: null, sensitive: false },
      ],
    });
    const report = new Validator(root, PATTERNS).validate(h);
    expect(report.failures.some((f) => f.includes("policy.paths") && f.includes("traversal"))).toBe(true);
  });

  it("fails on absolute out-of-root artifact paths", () => {
    const root = makeProject();
    const h = handoff({
      artifacts: [
        { path: "/etc/passwd", role: "read", description: null, revision: null, content_hash: null, sensitive: false },
      ],
    });
    const report = new Validator(root, PATTERNS).validate(h);
    expect(report.failures.some((f) => f.includes("outside-root"))).toBe(true);
  });

  it("blocks secret-like values that were not redacted (§22.4)", () => {
    const root = makeProject();
    writeFileSync(join(root, "src/auth/callback.ts"), "x");
    const h = handoff({
      summary: { completed: [], current_state: "used sk-abcdefghijklmnopqrstuvwx in config", why_it_matters: null },
    });
    const report = new Validator(root, PATTERNS).validate(h);
    expect(report.failures.some((f) => f.includes("policy.secrets"))).toBe(true);
  });

  it("passes already-redacted values (redaction ledger exempt)", () => {
    const root = makeProject();
    writeFileSync(join(root, "src/auth/callback.ts"), "x");
    const h = handoff({
      summary: { completed: [], current_state: "used [REDACTED] in config", why_it_matters: null },
      redactions: [{ field: "summary.current_state", reason: "matched secret policy", replacement: "[REDACTED]" }],
    });
    const report = new Validator(root, PATTERNS).validate(h);
    expect(report.failures.some((f) => f.includes("policy.secrets"))).toBe(false);
  });

  it("fails on transcript fields (§16)", () => {
    const root = makeProject();
    const h = handoff();
    (h as unknown as Record<string, unknown>)["messages"] = [{ role: "user", content: "hi" }];
    const report = new Validator(root, PATTERNS).validate(h);
    expect(report.failures.some((f) => f.includes("policy.transcript"))).toBe(true);
  });

  it("fails on missing evidence references (§22.8)", () => {
    const root = makeProject();
    writeFileSync(join(root, "src/auth/callback.ts"), "x");
    const h = handoff({
      decisions: [
        {
          id: "D-001",
          decision: "d",
          rationale: null,
          alternatives_considered: [],
          evidence_ids: ["E-999"],
          made_at: "2026-09-02T14:20:00Z",
        },
      ],
    });
    const report = new Validator(root, PATTERNS).validate(h);
    expect(report.failures.some((f) => f.includes("E-999"))).toBe(true);
  });

  it("recheck runs only allowlisted commands (§22.8)", () => {
    const root = makeProject();
    writeFileSync(join(root, "src/auth/callback.ts"), "x");
    const h = handoff();
    const ran: string[] = [];
    const report = new Validator(root, PATTERNS, {
      recheck: true,
      recheckAllowlist: ["npm test -- auth/callback.test.ts"],
      runCommand: (cmd) => {
        ran.push(cmd);
        return { code: 0, output: "" };
      },
    }).validate(h);
    expect(ran).toEqual(["npm test -- auth/callback.test.ts"]);
    expect(report.status).toBe("pass");

    const report2 = new Validator(root, PATTERNS, {
      recheck: true,
      recheckAllowlist: ["other-command"],
      runCommand: (cmd) => {
        ran.push(cmd);
        return { code: 0, output: "" };
      },
    }).validate(h);
    expect(report2.warnings.some((w) => w.includes("not allowlisted"))).toBe(true);
  });

  it("recheck failure fails validation", () => {
    const root = makeProject();
    writeFileSync(join(root, "src/auth/callback.ts"), "x");
    const report = new Validator(root, PATTERNS, {
      recheck: true,
      recheckAllowlist: ["npm test -- auth/callback.test.ts"],
      runCommand: () => ({ code: 1, output: "" }),
    }).validate(handoff());
    expect(report.failures.some((f) => f.includes("recheck failed"))).toBe(true);
  });

  it("warns when neither actionable open item nor completed state exists", () => {
    const root = makeProject();
    writeFileSync(join(root, "src/auth/callback.ts"), "x");
    const h = handoff({
      open_items: [],
      summary: { completed: [], current_state: "unclear", why_it_matters: null },
    });
    const report = new Validator(root, PATTERNS).validate(h);
    expect(report.warnings.some((w) => w.includes("actionability"))).toBe(true);
  });

  it("fails merge lineage with fewer than two parents (§22.8)", () => {
    const root = makeProject();
    writeFileSync(join(root, "src/auth/callback.ts"), "x");
    const h = handoff({ lineage: { parents: [], relation: "merge", branch_label: null, merge_basis: [] } });
    const report = new Validator(root, PATTERNS).validate(h);
    expect(report.failures.some((f) => f.includes("merge"))).toBe(true);
  });

  it("fails continue lineage without parents", () => {
    const root = makeProject();
    const h = handoff({ lineage: { parents: [], relation: "continue", branch_label: null, merge_basis: [] } });
    const report = new Validator(root, PATTERNS).validate(h);
    expect(report.failures.some((f) => f.includes("lineage"))).toBe(true);
  });
});
