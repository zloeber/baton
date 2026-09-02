/**
 * Freshness (spec §10, §22.3; improvement plan §19): on resume, compare the
 * captured git head and artifact hashes against the current repository state
 * and report drift prominently rather than silently applying stale
 * assumptions. Resume surfaces a derived state — fresh, partially_stale,
 * stale, or unknown — instead of a bare boolean.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Handoff, Freshness } from "./schema.js";

export function fileSha256(absPath: string): string | null {
  if (!existsSync(absPath)) return null;
  return `sha256:${createHash("sha256").update(readFileSync(absPath)).digest("hex")}`;
}

/** Derived freshness states surfaced on resume (improvement plan §19). */
export type FreshnessState = "fresh" | "partially_stale" | "stale" | "unknown";

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
    drifted_artifacts: drifted,
  } as Freshness & { drifted_artifacts: string[] };
}

/**
 * Derive the four-state freshness model from a computed/captured block:
 * - `unknown`    — freshness was never evaluated
 * - `fresh`      — nothing moved
 * - `stale`      — the repository head moved (whole-repo signal)
 * - `partially_stale` — only artifact content drifted; head unchanged
 */
export function freshnessState(f: Freshness | null | undefined): FreshnessState {
  if (!f) return "unknown";
  if (!f.stale) return "fresh";
  const ext = f as Freshness & { drifted_artifacts?: string[] };
  const headEqual =
    f.git_head_at_capture !== null &&
    f.git_head_now !== null &&
    f.git_head_at_capture === f.git_head_now;
  if (headEqual && Array.isArray(ext.drifted_artifacts)) {
    return "partially_stale";
  }
  return "stale";
}

/** Fresh when nothing moved (or when nothing was captured to compare). */
export function isFresh(f: Freshness | null): boolean {
  if (!f) return true;
  return !f.stale;
}

export function freshnessFrom(h: Handoff): Freshness | null {
  return h.validation.freshness ?? null;
}
