import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { computeFreshness, isFresh, freshnessState } from "../src/freshness.js";
import { HandoffSchema } from "../src/schema.js";
import { createHash } from "node:crypto";
import fixture from "../../../tests/fixtures/handoff-ready.json" with { type: "json" };

let dir: string;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function project(): string {
  dir = mkdtempSync(join(tmpdir(), "baton-fresh-"));
  mkdirSync(join(dir, "src/auth"), { recursive: true });
  return dir;
}

function sha(content: string): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

describe("freshness (§22.3)", () => {
  it("flags a moved git head as stale", () => {
    const root = project();
    const h = HandoffSchema.parse(fixture);
    const f = computeFreshness(h, root, "999999999999");
    expect(f.stale).toBe(true);
    expect(f.git_head_now).toBe("999999999999");
    expect(isFresh(f)).toBe(false);
  });

  it("flags changed artifact content as stale", () => {
    const root = project();
    writeFileSync(join(root, "src/auth/callback.ts"), "original");
    const h = HandoffSchema.parse({
      ...fixture,
      artifacts: [
        {
          path: "src/auth/callback.ts",
          role: "modified",
          description: null,
          revision: null,
          content_hash: sha("changed on disk"),
          sensitive: false,
        },
      ],
    });
    const f = computeFreshness(h, root, h.project.repository?.head ?? null);
    expect(f.stale).toBe(true);
  });

  it("stays fresh when nothing moved", () => {
    const root = project();
    writeFileSync(join(root, "src/auth/callback.ts"), "same");
    const h = HandoffSchema.parse({
      ...fixture,
      artifacts: [
        {
          path: "src/auth/callback.ts",
          role: "modified",
          description: null,
          revision: null,
          content_hash: sha("same"),
          sensitive: false,
        },
      ],
    });
    const f = computeFreshness(h, root, "abc123def456");
    expect(f.stale).toBe(false);
  });

  it("missing files are not treated as drift (artifact check covers existence)", () => {
    const root = project();
    const h = HandoffSchema.parse(fixture);
    const f = computeFreshness(h, root, "abc123def456");
    expect(f.stale).toBe(false);
  });
});

describe("freshnessState (improvement plan §19)", () => {
  it("is unknown when freshness was never evaluated", () => {
    expect(freshnessState(null)).toBe("unknown");
    expect(freshnessState(undefined)).toBe("unknown");
  });

  it("is fresh when nothing moved", () => {
    expect(
      freshnessState({ git_head_at_capture: "a", git_head_now: "a", stale: false }),
    ).toBe("fresh");
  });

  it("is stale when the head moved", () => {
    expect(
      freshnessState({ git_head_at_capture: "a", git_head_now: "b", stale: true }),
    ).toBe("stale");
  });

  it("is partially_stale for artifact-only drift (head unchanged)", () => {
    expect(
      freshnessState({
        git_head_at_capture: "a",
        git_head_now: "a",
        stale: true,
        drifted_artifacts: ["src/auth/callback.ts"],
      } as never),
    ).toBe("partially_stale");
  });

  it("computeFreshness always emits drifted_artifacts (possibly empty)", () => {
    const root = project();
    const h = HandoffSchema.parse(fixture);
    const f = computeFreshness(h, root, h.project.repository?.head ?? null) as { drifted_artifacts?: string[] };
    expect(Array.isArray(f.drifted_artifacts)).toBe(true);
    expect(f.drifted_artifacts).toHaveLength(0);
  });
});
