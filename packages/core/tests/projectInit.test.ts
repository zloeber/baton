import { mkdtempSync, existsSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  defaultConfig,
  findProjectRoot,
  initProject,
  isInitialized,
  loadConfig,
  saveConfig,
} from "../src/projectInit.js";

let dir: string;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

describe("initProject", () => {
  it("creates .threadline structure without touching global git", () => {
    dir = mkdtempSync(join(tmpdir(), "threadline-init-"));
    const r = initProject(dir);
    expect(r.created).toContain(".threadline/config.json");
    expect(r.created).toContain(".threadline/policy.json");
    expect(existsSync(join(dir, ".threadline/handoffs"))).toBe(true);
    const cfg = JSON.parse(readFileSync(join(dir, ".threadline/config.json"), "utf8"));
    expect(cfg.schema_version).toBe("0.1");
    expect(cfg.policy.secretPatterns.length).toBeGreaterThan(0);
  });

  it("is idempotent: re-init reports existing", () => {
    dir = mkdtempSync(join(tmpdir(), "threadline-init2-"));
    initProject(dir);
    const again = initProject(dir);
    expect(again.existing).toContain(".threadline/config.json");
    expect(again.existing).toContain(".threadline/policy.json");
  });
});

describe("config", () => {
  it("loads defaults for a missing file and merges detector overrides", () => {
    dir = mkdtempSync(join(tmpdir(), "threadline-cfg-"));
    initProject(dir);
    const cfg = loadConfig(dir);
    expect(cfg.detector.recommendThreshold).toBe(0.7);
    cfg.detector.recommendThreshold = 0.5;
    saveConfig(dir, cfg);
    expect(loadConfig(dir).detector.recommendThreshold).toBe(0.5);
  });

  it("applies local.json override over config.json", () => {
    dir = mkdtempSync(join(tmpdir(), "threadline-cfg2-"));
    initProject(dir);
    mkdirSync(join(dir, ".threadline"), { recursive: true });
    writeFileSync(
      join(dir, ".threadline/local.json"),
      JSON.stringify({ policy: { hashSessionIds: false } }),
    );
    expect(loadConfig(dir).policy.hashSessionIds).toBe(false);
  });

  it("rejects malformed configs with explicit errors", () => {
    dir = mkdtempSync(join(tmpdir(), "threadline-cfg3-"));
    initProject(dir);
    writeFileSync(join(dir, ".threadline/config.json"), "{ not json");
    expect(() => loadConfig(dir)).toThrow();
  });
});

describe("findProjectRoot", () => {
  it("walks up to the nearest initialized root", () => {
    dir = mkdtempSync(join(tmpdir(), "threadline-root-"));
    initProject(dir);
    const nested = join(dir, "a", "b");
    mkdirSync(nested, { recursive: true });
    expect(findProjectRoot(nested)).toBe(dir);
    expect(findProjectRoot(tmpdir())).toBeNull();
  });

  it("isInitialized reflects config presence", () => {
    dir = mkdtempSync(join(tmpdir(), "threadline-init3-"));
    expect(isInitialized(dir)).toBe(false);
    initProject(dir);
    expect(isInitialized(dir)).toBe(true);
  });

  it("defaultConfig parses through its own schema", () => {
    expect(defaultConfig().policy.allowedRoots).toEqual([]);
  });
});
