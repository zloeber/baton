import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

export interface GitInfo {
  vcs: "git" | null;
  remote_hint: string | null;
  head: string | null;
  dirty: boolean | null;
}

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
