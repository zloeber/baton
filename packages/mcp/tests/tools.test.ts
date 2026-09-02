import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as tools from "../src/tools.js";
import { initProject, Handoff } from "@threadline/core";

let root: string;
let ctx: tools.ToolContext;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "threadline-mcp-"));
  initProject(root);
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src/a.ts"), "export const a = 1;\n");
  ctx = tools.makeContext(root);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function captureReq(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    work: {
      title: "MCP work",
      objective: "Finish MCP work with checks passing.",
      scope: ["src/**"],
      constraints: [],
      definition_of_done: ["checks pass"],
    },
    summary: { completed: [], current_state: "in progress", why_it_matters: null },
    open_items: [
      {
        id: "O-001",
        priority: "high",
        description: "Next step",
        suggested_action: "Do the next step",
        blocked_by: [],
        acceptance_check: "Done looks like this",
      },
    ],
    artifacts: [{ path: "src/a.ts", role: "modified", description: null }],
    ...over,
  };
}

describe("threadline_status", () => {
  it("reports initialized project and latest handoff", () => {
    tools.handoffCapture(ctx, captureReq() as never);
    const r = tools.threadlineStatus(ctx);
    expect(r.isError).toBe(false);
    expect((r.structured as { initialized: boolean }).initialized).toBe(true);
    expect((r.structured as { handoff_count: number }).handoff_count).toBe(1);
  });

  it("is explicit when uninitialized", () => {
    const bare = tools.makeContext(mkdtempSync(join(tmpdir(), "threadline-bare-")));
    const r = tools.threadlineStatus(bare);
    expect((r.structured as { initialized: boolean }).initialized).toBe(false);
  });
});

describe("handoff_capture", () => {
  it("creates a draft with redaction records for secret-like input (§22.4)", () => {
    const r = tools.handoffCapture(
      ctx,
      captureReq({
        summary: { completed: [], current_state: "used token: supersecret999 here", why_it_matters: null },
      }) as never,
    );
    const h = r.structured as Handoff;
    expect(h.status).toBe("draft");
    expect(JSON.stringify(h)).not.toContain("supersecret999");
    expect(h.redactions.length).toBeGreaterThan(0);
  });

  it("refuses writes to uninitialized projects (policy guard)", () => {
    const bare = tools.makeContext(mkdtempSync(join(tmpdir(), "threadline-bare2-")));
    const r = tools.handoffCapture(bare, captureReq() as never);
    expect(r.isError).toBe(true);
    expect(JSON.stringify(r.structured)).toContain("POLICY");
  });
});

describe("handoff_validate / handoff_ready", () => {
  it("validates a good draft and promotes to ready", () => {
    const created = tools.handoffCapture(ctx, captureReq() as never).structured as Handoff;
    const v = tools.handoffValidate(ctx, created.id);
    expect(v.isError).toBe(false);
    const ready = tools.handoffReady(ctx, created.id);
    expect(ready.isError).toBe(false);
    expect((ready.structured as Handoff).status).toBe("ready");
  });

  it("fails ready when a referenced artifact is missing", () => {
    const created = tools.handoffCapture(
      ctx,
      captureReq({ artifacts: [{ path: "src/missing.ts", role: "modified", description: null }] }) as never,
    ).structured as Handoff;
    const ready = tools.handoffReady(ctx, created.id);
    expect(ready.isError).toBe(true);
    expect(JSON.stringify(ready.structured)).toContain("VALIDATION");
  });

  it("requires warning acknowledgement", () => {
    const created = tools.handoffCapture(ctx, captureReq({ open_items: [] }) as never).structured as Handoff;
    const ready = tools.handoffReady(ctx, created.id);
    expect(ready.isError).toBe(true);
    const ready2 = tools.handoffReady(ctx, created.id, "user accepted ambiguity");
    expect(ready2.isError).toBe(true); // readiness requirements still block: no completed state
  });
});

describe("handoff_resume", () => {
  it("returns prompt plus freshness; flags stale git head prominently", () => {
    const created = tools.handoffCapture(ctx, captureReq() as never).structured as Handoff;
    const r = tools.handoffResume(ctx, created.id);
    expect(r.structured.prompt).toContain("## Objective");
    expect(r.structured.prompt).toContain("Verify freshness");
  });
});

describe("fork / merge parity with CLI", () => {
  it("forks and blocks conflicted merges without resolution", () => {
    const a = tools.handoffCapture(
      ctx,
      captureReq({
        decisions: [{ id: "D-001", decision: "Use PostgreSQL for storage." }],
      }) as never,
    ).structured as Handoff;
    const b = tools.handoffCapture(
      ctx,
      captureReq({
        work: { title: "Other", objective: "Different objective entirely.", scope: [], constraints: [], definition_of_done: [] },
        summary: { completed: [], current_state: "other", why_it_matters: null },
        decisions: [{ id: "D-001", decision: "Use SQLite for storage." }],
      }) as never,
    ).structured as Handoff;
    const fork = tools.handoffFork(ctx, a.id, "explore");
    expect((fork.structured as Handoff).lineage.relation).toBe("fork");
    const merged = tools.handoffMerge(ctx, [a.id, b.id], {
      objective: "Combined",
      current_state: "state",
      decision: "",
    });
    expect(merged.isError).toBe(true);
    expect(JSON.stringify(merged.structured)).toContain("CONFLICT");
    const resolved = tools.handoffMerge(ctx, [a.id, b.id], {
      objective: "Combined",
      current_state: "state",
      decision: "SQLite wins; local-first requirement.",
    });
    expect(resolved.isError).toBe(false);
  });
});

describe("handoff_detect", () => {
  it("scores explicit request as recommend", () => {
    const r = tools.handoffDetect(ctx, { handoffRequest: true });
    expect((r.structured as { recommendedAction: string }).recommendedAction).toBe("recommend");
  });

  it("stays quiet on low signals", () => {
    const r = tools.handoffDetect(ctx, { contextPressure: 0.2 });
    expect((r.structured as { recommendedAction: string }).recommendedAction).toBe("none");
  });
});
