import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { initProject } from "@baton/core";
import { GenericAdapter } from "../src/index.js";

let root: string;
const CLI_TS = new URL("../../cli/dist/main.js", import.meta.url).pathname;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "baton-adapter-"));
  initProject(root);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

// Recorded synthetic fixtures (examples/adapter-events/events.json contract).
const FIXTURES: { name: string; event: Record<string, unknown>; expectAction: string }[] = [
  {
    name: "high pressure, high readiness -> prepare",
    event: { harness: "generic", signals: { contextPressure: 1, turnPressure: 1, elapsedPressure: 1, changePressure: 1, resumeReadiness: 0.9 } },
    expectAction: "prepare",
  },
  {
    name: "low signals -> none",
    event: { harness: "generic", signals: { contextPressure: 0.2 } },
    expectAction: "none",
  },
  {
    name: "explicit request -> recommend",
    event: { harness: "generic", signals: { handoffRequest: true } },
    expectAction: "recommend",
  },
];

describe("GenericAdapter contract (spec §15, §22.9)", () => {
  it("exposes project context and session metadata", async () => {
    const a = new GenericAdapter({ rootDir: root });
    const ctx = await a.getProjectContext();
    expect(ctx.initialized).toBe(true);
    expect(ctx.projectId).toMatch(/^sha256:/);
    const meta = await a.getSessionMetadata();
    expect(meta.harness).toBe("generic");
    expect(meta.sessionId).toBeNull();
  });

  for (const f of FIXTURES) {
    it(`fixture: ${f.name}`, () => {
      const a = new GenericAdapter({ rootDir: root, cliCommand: "node", cliArgs: [CLI_TS] });
      const r = a.detectViaCli(f.event as never);
      expect(r.recommendedAction).toBe(f.expectAction);
      expect(r.reasons.length).toBeGreaterThan(0);
    });
  }

  it("renders a resume brief through the CLI", () => {
    execFileSync("node", [
      CLI_TS,
      "--json",
      "checkpoint",
      "create",
      "--title",
      "Adapter test work",
      "--objective",
      "Test adapter resume.",
      "--current-state",
      "ready to resume",
    ], { cwd: root });
    const listings = JSON.parse(
      execFileSync("node", [CLI_TS, "--json", "handoff", "list"], { cwd: root, encoding: "utf8" }),
    ) as { handoffs: { id: string }[] };
    const a = new GenericAdapter({ rootDir: root, cliCommand: "node", cliArgs: [CLI_TS] });
    const brief = a.resumeViaCli(listings.handoffs[0]!.id);
    expect(brief).toContain("## Objective");
  });
});
