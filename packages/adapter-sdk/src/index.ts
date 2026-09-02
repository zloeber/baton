/**
 * @baton/adapter-sdk (spec §15)
 *
 * The universal integration is a shell command plus a Markdown skill; this
 * SDK exists for harnesses that can emit normalized events. All integrations
 * are optional and thin. No adapter may require raw messages or hidden
 * prompts, and vendor code must live in separate packages tested with
 * recorded fixtures.
 *
 * Implement `BatonAdapter` and feed `AdapterEvent`s to
 * `@baton/core`'s `evaluateEvent` (or the `baton detect --event`
 * CLI). Render the returned recommendation through `renderNotice` if the
 * harness exposes a UI affordance.
 */
export type {
  AdapterEvent,
  DetectorSignals,
  DetectorResult,
  SignalSnapshot,
} from "@baton/core";
export {
  evaluateEvent,
  nullSignals,
  SIGNAL_KEYS,
  SIGNAL_LABELS,
} from "@baton/core";
export type {
  BatonAdapter,
  ProjectContext,
  SessionMetadata,
  RecommendationAction,
  RenderNoticeInput,
} from "@baton/core";
export { ADAPTER_INTERFACE_VERSION } from "@baton/core";
