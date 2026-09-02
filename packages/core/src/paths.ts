import { createHash } from "node:crypto";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

export function sha256(content: string | Buffer): string {
  return `sha256:${createHash("sha256").update(content).digest("hex")}`;
}

/**
 * True when `candidate` resolves inside `rootDir`. Rejects traversal and
 * absolute escapes (spec §16: default scope is the current project root).
 */
export function isInsideRoot(rootDir: string, candidate: string): boolean {
  const rootAbs = resolve(rootDir);
  const candidateAbs = isAbsolute(candidate) ? resolve(candidate) : resolve(rootAbs, candidate);
  if (candidateAbs === rootAbs) return true;
  const rel = relative(rootAbs, candidateAbs);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

/** Normalized path inside root, or null if it escapes root. */
export function containedPath(rootDir: string, candidate: string): string | null {
  const rootAbs = resolve(rootDir);
  const candidateAbs = isAbsolute(candidate) ? resolve(candidate) : resolve(rootAbs, candidate);
  if (!isInsideRoot(rootAbs, candidateAbs)) return null;
  const rel = relative(rootAbs, candidateAbs);
  if (rel === "") return ".";
  return rel.split(sep).join("/");
}
