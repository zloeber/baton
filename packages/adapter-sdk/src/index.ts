/**
 * @threadline/adapter-sdk (spec §15)
 *
 * The universal integration is a shell command plus a Markdown skill; this
 * SDK exists for harnesses that can emit normalized events. All integrations
 * are optional and thin. No adapter may require raw messages or hidden
 * prompts, and vendor code must live in separate packages tested with
 * recorded fixtures.
 *
 * Implement `ThreadlineAdapter` and feed `AdapterEvent`s to
 * `@threadline/core`'s `evaluateEvent` (or the `threadline detect --event`
 * CLI). Render the returned recommendation through `renderNotice` if the
 * harness exposes a UI affordance.
 */
export type {
  AdapterEvent,
  DetectorSignals,
  DetectorResult,
  SignalSnapshot,
} from "@threadline/core";
export {
  evaluateEvent,
  nullSignals,
  SIGNAL_KEYS,
  SIGNAL_LABELS,
} from "@threadline/core";
export type {
  ThreadlineAdapter,
  ProjectContext,
  SessionMetadata,
  RecommendationAction,
  RenderNoticeInput,
} from "@threadline/core";
export { ADAPTER_INTERFACE_VERSION } from "@threadline/core";
