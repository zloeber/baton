import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { captureRepositoryState, GIT_FILE_LIST_LIMIT } from "../src/gitAdapter.js";

let dir: string;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function gitProject(): string {
  dir = mkdtempSync(join(tmpdir(), "baton-git-"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "t@t"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "t"], { cwd: dir });
  writeFileSync(join(dir, "README.md"), "# t\n");
  execFileSync("git", ["add", "."], { cwd: dir });
  execFileSync("git", ["-c", "commit.gpgsign=false", "commit", "-qm", "init"], { cwd: dir });
  return dir;
}

describe("captureRepositoryState (improvement plan §18)", () => {
  it("returns nulls and empty lists outside a git repository", () => {
    dir = mkdtempSync(join(tmpdir(), "baton-nogit-"));
    const s = captureRepositoryState(dir);
    expect(s.branch).toBeNull();
    expect(s.head).toBeNull();
    expect(s.dirty).toBeNull();
    expect(s.changed_files).toEqual([]);
    expect(s.lockfile_fingerprint).toBeNull();
  });

  it("captures branch, staged, and untracked files", () => {
    const root = gitProject();
    writeFileSync(join(root, "staged.ts"), "export const a = 1;\n");
    writeFileSync(join(root, "untracked.ts"), "export const b = 2;\n");
    execFileSync("git", ["add", "staged.ts"], { cwd: root });
    const s = captureRepositoryState(root);
    expect(s.branch).toBeTypeOf("string");
    expect(s.head).toMatch(/^[0-9a-f]{40}$/);
    expect(s.dirty).toBe(true);
    expect(s.changed_files).toContain("staged.ts");
    expect(s.changed_files).toContain("untracked.ts");
    expect(s.staged_files).toContain("staged.ts");
    expect(s.untracked_files).toContain("untracked.ts");
  });

  it("captures a lockfile fingerprint when a lockfile exists", () => {
    const root = gitProject();
    writeFileSync(join(root, "pnpm-lock.yaml"), "lockfileVersion: 9\n");
    const s = captureRepositoryState(root);
    expect(s.lockfile_fingerprint).toBeTypeOf("string");
    expect((s.lockfile_fingerprint as string).length).toBe(40); // git blob sha
  });

  it("caps file lists at the documented limit", () => {
    const root = gitProject();
    for (let i = 0; i < GIT_FILE_LIST_LIMIT + 10; i++) {
      writeFileSync(join(root, `f${i}.txt`), `${i}\n`);
    }
    const s = captureRepositoryState(root);
    expect(s.changed_files.length).toBeLessThanOrEqual(GIT_FILE_LIST_LIMIT + 1);
    expect(s.changed_files[s.changed_files.length - 1]).toMatch(/more\)$/);
  });
});
