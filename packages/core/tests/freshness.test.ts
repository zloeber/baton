import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { computeFreshness, isFresh } from "../src/freshness.js";
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
