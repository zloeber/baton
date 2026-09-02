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
  it("creates .baton structure without touching global git", () => {
    dir = mkdtempSync(join(tmpdir(), "baton-init-"));
    const r = initProject(dir);
    expect(r.created).toContain(".baton/config.json");
    expect(r.created).toContain(".baton/policy.json");
    expect(existsSync(join(dir, ".baton/handoffs"))).toBe(true);
    const cfg = JSON.parse(readFileSync(join(dir, ".baton/config.json"), "utf8"));
    expect(cfg.schema_version).toBe("0.1");
    expect(cfg.policy.secretPatterns.length).toBeGreaterThan(0);
  });

  it("is idempotent: re-init reports existing", () => {
    dir = mkdtempSync(join(tmpdir(), "baton-init2-"));
    initProject(dir);
    const again = initProject(dir);
    expect(again.existing).toContain(".baton/config.json");
    expect(again.existing).toContain(".baton/policy.json");
  });
});

describe("config", () => {
  it("loads defaults for a missing file and merges detector overrides", () => {
    dir = mkdtempSync(join(tmpdir(), "baton-cfg-"));
    initProject(dir);
    const cfg = loadConfig(dir);
    expect(cfg.detector.recommendThreshold).toBe(0.7);
    cfg.detector.recommendThreshold = 0.5;
    saveConfig(dir, cfg);
    expect(loadConfig(dir).detector.recommendThreshold).toBe(0.5);
  });

  it("applies local.json override over config.json", () => {
    dir = mkdtempSync(join(tmpdir(), "baton-cfg2-"));
    initProject(dir);
    mkdirSync(join(dir, ".baton"), { recursive: true });
    writeFileSync(
      join(dir, ".baton/local.json"),
      JSON.stringify({ policy: { hashSessionIds: false } }),
    );
    expect(loadConfig(dir).policy.hashSessionIds).toBe(false);
  });

  it("rejects malformed configs with explicit errors", () => {
    dir = mkdtempSync(join(tmpdir(), "baton-cfg3-"));
    initProject(dir);
    writeFileSync(join(dir, ".baton/config.json"), "{ not json");
    expect(() => loadConfig(dir)).toThrow();
  });
});

describe("findProjectRoot", () => {
  it("walks up to the nearest initialized root", () => {
    dir = mkdtempSync(join(tmpdir(), "baton-root-"));
    initProject(dir);
    const nested = join(dir, "a", "b");
    mkdirSync(nested, { recursive: true });
    expect(findProjectRoot(nested)).toBe(dir);
    expect(findProjectRoot(tmpdir())).toBeNull();
  });

  it("isInitialized reflects config presence", () => {
    dir = mkdtempSync(join(tmpdir(), "baton-init3-"));
    expect(isInitialized(dir)).toBe(false);
    initProject(dir);
    expect(isInitialized(dir)).toBe(true);
  });

  it("defaultConfig parses through its own schema", () => {
    expect(defaultConfig().policy.allowedRoots).toEqual([]);
  });
});
