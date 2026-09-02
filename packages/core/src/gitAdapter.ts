import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

export interface GitInfo {
  vcs: "git" | null;
  remote_hint: string | null;
  head: string | null;
  dirty: boolean | null;
}

/**
 * Objective repository state captured with a handoff (improvement plan §18).
 * File lists are bounded so a pathological tree cannot explode the record.
 */
export const GIT_FILE_LIST_LIMIT = 50;

function git(cwd: string, args: string[]): string | null {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

/** Best-effort git metadata; nulls degrade gracefully in non-git projects. */
export function captureGitInfo(rootDir: string): GitInfo {
  if (!existsSync(join(rootDir, ".git"))) {
    return { vcs: null, remote_hint: null, head: null, dirty: null };
  }
  const head = git(rootDir, ["rev-parse", "HEAD"]);
  const dirty = head === null ? null : git(rootDir, ["status", "--porcelain"]) !== "";
  const remote = git(rootDir, ["remote", "get-url", "origin"]);
  const remoteHint = remote === null ? null : remote.replace(/^git@([^:]+):/, "$1/").replace(/^https?:\/\//, "").replace(/\.git$/, "");
  return {
    vcs: "git",
    remote_hint: remoteHint,
    head: head !== null && head !== "" ? head.slice(0, 12) : null,
    dirty,
  };
}

function splitPorcelain(out: string | null): string[] {
  if (out === null || out === "") return [];
  return out
    .split("\n")
    .map((l) => l.slice(3).trim().replace(/^"|"$/g, ""))
    .filter((l) => l !== "");
}

/**
 * Extended repository snapshot: branch, dirty file lists, and lockfile
 * fingerprint. All fields are null-safe for non-git projects. The lists are
 * capped at GIT_FILE_LIST_LIMIT entries each (with a trailing count when
 * truncated) to keep canonical records bounded.
 */
export function captureRepositoryState(rootDir: string): {
  branch: string | null;
  head: string | null;
  dirty: boolean | null;
  changed_files: string[];
  staged_files: string[];
  untracked_files: string[];
  lockfile_fingerprint: string | null;
} {
  if (!existsSync(join(rootDir, ".git"))) {
    return {
      branch: null,
      head: null,
      dirty: null,
      changed_files: [],
      staged_files: [],
      untracked_files: [],
      lockfile_fingerprint: null,
    };
  }
  const out = git(rootDir, ["status", "--porcelain"]) ?? "";
  const changed: string[] = [];
  const staged: string[] = [];
  const untracked: string[] = [];
  for (const line of out.split("\n")) {
    if (line.length < 4) continue;
    const x = line[0]!;
    const y = line[1]!;
    const path = line.slice(3).trim().replace(/^"|"$/g, "");
    if (path === "") continue;
    changed.push(path);
    if (x !== " " && x !== "?") staged.push(path);
    if (x === "?" || y === "?") untracked.push(path);
  }
  const cap = (files: string[]): string[] =>
    files.length <= GIT_FILE_LIST_LIMIT
      ? files
      : [...files.slice(0, GIT_FILE_LIST_LIMIT), `… (${files.length - GIT_FILE_LIST_LIMIT} more)`];
  const lockDigest = git(rootDir, ["hash-object", "pnpm-lock.yaml"]) ?? git(rootDir, ["hash-object", "package-lock.json"]);
  return {
    branch: git(rootDir, ["rev-parse", "--abbrev-ref", "HEAD"]),
    head: git(rootDir, ["rev-parse", "HEAD"]),
    dirty: out !== "",
    changed_files: cap(changed),
    staged_files: cap(staged),
    untracked_files: cap(untracked),
    lockfile_fingerprint: lockDigest,
  };
}
