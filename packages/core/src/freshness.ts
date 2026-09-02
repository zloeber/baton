/**
 * Freshness (spec §10, §22.3): on resume, compare the captured git head and
 * artifact hashes against the current repository state and report drift
 * prominently rather than silently applying stale assumptions.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Handoff, Freshness } from "./schema.js";

export function fileSha256(absPath: string): string | null {
  if (!existsSync(absPath)) return null;
  return `sha256:${createHash("sha256").update(readFileSync(absPath)).digest("hex")}`;
}

/**
 * Compare captured state against the current filesystem. `gitHeadNow` comes
 * from the platform layer; artifact hashes are checked directly.
 */
export function computeFreshness(h: Handoff, rootDir: string, gitHeadNow: string | null): Freshness {
  const capturedHead = h.project.repository?.head ?? null;
  const staleHead = capturedHead !== null && gitHeadNow !== null && capturedHead !== gitHeadNow;
  let staleArtifact = false;
  const drifted: string[] = [];
  for (const a of h.artifacts) {
    if (a.content_hash && a.role !== "read") {
      const actual = fileSha256(resolve(rootDir, a.path));
      if (actual !== null && actual !== a.content_hash) {
        staleArtifact = true;
        drifted.push(a.path);
      }
    }
  }
  return {
    git_head_at_capture: capturedHead,
    git_head_now: gitHeadNow,
    stale: staleHead || staleArtifact,
    ...(staleArtifact ? { drifted_artifacts: drifted } : {}),
  } as Freshness & { drifted_artifacts?: string[] };
}

/** Fresh when nothing moved (or when nothing was captured to compare). */
export function isFresh(f: Freshness | null): boolean {
  if (!f) return true;
  return !f.stale;
}

export function freshnessFrom(h: Handoff): Freshness | null {
  return h.validation.freshness ?? null;
}
