/**
 * Adapter SDK (spec §15): a tiny normalized interface. No adapter may require
 * raw messages or hidden prompts; vendor-specific code lives in separate
 * packages and is tested with recorded fixtures.
 */
import { AdapterEvent } from "../detect/index.js";
import { DetectorResult } from "../detect/index.js";
import { Harness } from "../schema.js";

export interface ProjectContext {
  rootDir: string;
  projectId: string;
  initialized: boolean;
}

export interface SessionMetadata {
  harness: Harness;
  sessionId: string | null;
  model: string | null;
}

export type RecommendationAction = "none" | "recommend" | "prepare";

export interface RenderNoticeInput {
  recommendation: DetectorResult & { recommendedAction: RecommendationAction };
}

export interface ThreadlineAdapter {
  /** Map the vendor surface onto a Threadline project context. */
  getProjectContext(): Promise<ProjectContext>;
  /** Session metadata allowed by policy (opaque ids; no raw messages). */
  getSessionMetadata(): Promise<SessionMetadata>;
  /** Optional normalized event stream from the vendor harness. */
  subscribeEvents?(handler: (event: AdapterEvent) => void): () => void;
  /** Optional UI affordance for surfacing a recommendation. */
  renderNotice?(input: RenderNoticeInput): void;
}

export const ADAPTER_INTERFACE_VERSION = "0.1.0";
