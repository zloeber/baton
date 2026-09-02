/**
 * Ephemeral session/detector state (spec §9, §14): prompt-suppression window
 * and last pressure score. Kept outside canonical records and rebuildable.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { atomicWriteJsonSync } from "./fsAtomic.js";
import { resolveBatonDir } from "./projectInit.js";

export interface DetectorState {
  last_prompt_at: string | null;
  last_pressure: number | null;
  session_disabled: boolean;
  session_id: string | null;
}

export function emptyDetectorState(): DetectorState {
  return { last_prompt_at: null, last_pressure: null, session_disabled: false, session_id: null };
}

export function detectorStatePath(rootDir: string): string {
  return join(resolveBatonDir(rootDir), "cache", "detector-state.json");
}

export function loadDetectorState(rootDir: string): DetectorState {
  const p = detectorStatePath(rootDir);
  if (!existsSync(p)) return emptyDetectorState();
  try {
    return { ...emptyDetectorState(), ...(JSON.parse(readFileSync(p, "utf8")) as Partial<DetectorState>) };
  } catch {
    return emptyDetectorState();
  }
}

export function saveDetectorState(rootDir: string, state: DetectorState): void {
  atomicWriteJsonSync(detectorStatePath(rootDir), state);
}
