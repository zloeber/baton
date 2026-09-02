/**
 * Handoff detection and scoring (spec §9).
 *
 * Deterministic and pure: inputs in, score + reasons out. The detector never
 * kills or launches a session (spec §3 goal 5, §22.5). The decision mechanism
 * stays auditable — signals normalize into a weighted composite, never an
 * opaque classifier (improvement plan §8).
 */
import { z } from "zod";
import { DetectorConfig } from "../projectInit.js";

/** Normalized 0–1 detector inputs; null = signal unavailable (§9.1). */
export interface DetectorSignals {
  contextPressure: number | null;
  turnPressure: number | null;
  elapsedPressure: number | null;
  workBoundary: boolean;
  handoffRequest: boolean;
  changePressure: number | null;
  stuckSignal: number | null;
  resumeReadiness: number | null;
  /** Semantic phase change (research→implement→verify, …), not a milestone. */
  semanticPhaseChange: boolean;
  /** Unresolved questions accumulated during the session (0–1). */
  unresolvedQuestions: number | null;
  /** Session age vs. configured soft duration (0–1). */
  sessionAgePressure: number | null;
}

export const SIGNAL_KEYS = [
  "contextPressure",
  "turnPressure",
  "elapsedPressure",
  "workBoundary",
  "handoffRequest",
  "changePressure",
  "stuckSignal",
  "resumeReadiness",
  "semanticPhaseChange",
  "unresolvedQuestions",
  "sessionAgePressure",
] as const;

export type SignalKey = (typeof SIGNAL_KEYS)[number];

export const SIGNAL_LABELS: Record<SignalKey, string> = {
  contextPressure: "harness context pressure",
  turnPressure: "turn budget pressure",
  elapsedPressure: "session elapsed pressure",
  workBoundary: "work boundary declared",
  handoffRequest: "explicit handoff request",
  changePressure: "uncommitted/advanced changes",
  stuckSignal: "repeated blockage detected",
  resumeReadiness: "resume readiness",
  semanticPhaseChange: "semantic phase change",
  unresolvedQuestions: "unresolved questions",
  sessionAgePressure: "session age pressure",
};

export function nullSignals(): DetectorSignals {
  return {
    contextPressure: null,
    turnPressure: null,
    elapsedPressure: null,
    workBoundary: false,
    handoffRequest: false,
    changePressure: null,
    stuckSignal: null,
    resumeReadiness: null,
    semanticPhaseChange: false,
    unresolvedQuestions: null,
    sessionAgePressure: null,
  };
}

export interface SignalSnapshot {
  key: SignalKey;
  value: number | boolean | null;
  used: boolean;
  label: string;
}

export interface DetectorResult {
  pressure: number;
  readiness: number | null;
  recommend: boolean;
  autoPrepare: boolean;
  reasons: string[];
  inputs: SignalSnapshot[];
}

/**
 * Pressure score per spec §9.2 (extended per improvement plan §8):
 *
 * pressure = max(
 *   1.00 * explicit_request,
 *   0.70*context + 0.15*turn + 0.10*elapsed + 0.05*change,
 *   0.60*stuck + 0.25*boundary + 0.15*change,
 *   0.35*phase_change + 0.30*unresolved_questions,
 *   0.20*session_age
 * )
 */
export function scorePressure(signals: DetectorSignals, cfg: DetectorConfig): { pressure: number; reasons: string[]; inputs: SignalSnapshot[] } {
  const w = cfg.weights;
  const inputs: SignalSnapshot[] = [];
  const push = (key: SignalKey, value: number | boolean | null, used: boolean) =>
    inputs.push({ key, value, used, label: SIGNAL_LABELS[key] });

  // Term 1: explicit request always wins.
  const explicit = signals.handoffRequest;
  push("handoffRequest", explicit, explicit);
  if (explicit) {
    return {
      pressure: 1.0 * w.explicitRequest,
      reasons: ["explicit handoff request"],
      inputs,
    };
  }

  // Term 2: resource-pressure composite (only available signals contribute).
  const ctx = signals.contextPressure;
  const turn = signals.turnPressure;
  const elapsed = signals.elapsedPressure;
  const change = signals.changePressure;
  let term2 = 0;
  let term2Any = false;
  if (ctx !== null) {
    term2 += w.contextPressure * ctx;
    term2Any = true;
  }
  if (turn !== null) {
    term2 += w.turnPressure * turn;
    term2Any = true;
  }
  if (elapsed !== null) {
    term2 += w.elapsedPressure * elapsed;
    term2Any = true;
  }
  if (change !== null) {
    term2 += w.changePressure * change;
    term2Any = true;
  }

  // Term 3: stuck/boundary composite.
  const stuck = signals.stuckSignal;
  const boundary = signals.workBoundary ? 1 : 0;
  let term3 = w.stuckSignal * (stuck ?? 0) + w.workBoundary * boundary + w.changePressure * (change ?? 0);
  const term3Any = stuck !== null || boundary > 0 || change !== null;

  // Term 4: phase-change/unresolved composite (improvement plan §8).
  const phase = signals.semanticPhaseChange ? 1 : 0;
  const unresolved = signals.unresolvedQuestions;
  const age = signals.sessionAgePressure;
  const term4 = w.semanticPhaseChange * phase + w.unresolvedQuestions * (unresolved ?? 0);
  const term4Any = phase > 0 || unresolved !== null;

  const terms: number[] = [0];
  if (term2Any) terms.push(term2);
  if (term3Any) terms.push(term3);
  if (term4Any) terms.push(term4);
  const pressure = Math.max(...terms, age !== null ? w.sessionAgePressure * age : 0);

  // Reasons: what actually drove the score, plainly showing unused signals.
  const reasons: string[] = [];
  if (term2Any && pressure === term2) {
    const parts: string[] = [];
    if (ctx !== null) parts.push(`context ${(ctx * 100).toFixed(0)}%`);
    if (turn !== null) parts.push(`turns ${(turn * 100).toFixed(0)}%`);
    if (elapsed !== null) parts.push(`elapsed ${(elapsed * 100).toFixed(0)}%`);
    if (change !== null) parts.push(`changes ${(change * 100).toFixed(0)}%`);
    if (parts.length > 0) reasons.push(`resource pressure: ${parts.join(", ")}`);
  }
  if (term3Any && pressure === term3) {
    const parts: string[] = [];
    if (stuck !== null && stuck > 0) parts.push(`stuck ${(stuck * 100).toFixed(0)}%`);
    if (boundary > 0) parts.push("work boundary declared");
    if (change !== null && change > 0) parts.push(`changes ${(change * 100).toFixed(0)}%`);
    if (parts.length > 0) reasons.push(`blockage/boundary: ${parts.join(", ")}`);
  }
  if (term4Any && pressure === term4 && pressure > 0) {
    const parts: string[] = [];
    if (phase > 0) parts.push("semantic phase change declared");
    if (unresolved !== null && unresolved > 0) parts.push(`unresolved questions ${(unresolved * 100).toFixed(0)}%`);
    if (parts.length > 0) reasons.push(`phase/complexity: ${parts.join(", ")}`);
  }
  if (age !== null && age > 0 && pressure === w.sessionAgePressure * age) {
    reasons.push(`session age ${(age * 100).toFixed(0)}% of soft duration`);
  }
  if (reasons.length === 0) reasons.push("no available pressure signals");

  push("contextPressure", ctx, ctx !== null);
  push("turnPressure", turn, turn !== null);
  push("elapsedPressure", elapsed, elapsed !== null);
  push("changePressure", change, change !== null);
  push("stuckSignal", stuck, stuck !== null);
  push("workBoundary", signals.workBoundary, signals.workBoundary);
  push("semanticPhaseChange", signals.semanticPhaseChange, signals.semanticPhaseChange);
  push("unresolvedQuestions", unresolved, unresolved !== null);
  push("sessionAgePressure", age, age !== null);

  return { pressure, reasons, inputs };
}

/** Readiness per §9.1 resume_readiness: fields + validation + next action. */
export function scoreReadiness(signals: DetectorSignals, _cfg: DetectorConfig): number {
  return clamp01(signals.resumeReadiness ?? 0);
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

/**
 * Full detector evaluation. `recommend` and `auto_prepare` follow §9.2;
 * explicit request always recommends (and would create a draft downstream).
 */
export function detectHandoff(signals: DetectorSignals, cfg: DetectorConfig): DetectorResult {
  const { pressure, reasons, inputs } = scorePressure(signals, cfg);
  const readiness =
    signals.resumeReadiness !== null ? clamp01(signals.resumeReadiness) : null;
  const recommend = pressure >= cfg.recommendThreshold;
  const autoPrepare =
    pressure >= cfg.autoPrepareThreshold && readiness !== null && readiness >= cfg.readinessThreshold;
  return { pressure, readiness, recommend, autoPrepare, reasons, inputs };
}

/**
 * Cooldown check: repeated prompts suppressed for the configured window or
 * until a material event (score jump or explicit request) occurs.
 */
export function shouldSuppressPrompt(lastPromptAt: string | null, previousPressure: number | null, current: DetectorResult, cfg: DetectorConfig, now: Date): { suppress: boolean; reason: string | null } {
  if (current.pressure >= 1 && (lastPromptAt !== null)) {
    // Explicit requests are never suppressed.
    if (current.reasons.includes("explicit handoff request")) return { suppress: false, reason: null };
  }
  if (lastPromptAt === null) return { suppress: false, reason: null };
  const last = Date.parse(lastPromptAt);
  const minutes = (now.getTime() - last) / 60000;
  if (minutes < cfg.promptCooldownMinutes) {
    const material =
      previousPressure === null ||
      current.pressure - previousPressure >= 0.15 ||
      current.reasons.includes("explicit handoff request");
    if (!material) {
      return { suppress: true, reason: `cooldown active for another ${(cfg.promptCooldownMinutes - minutes).toFixed(0)} min` };
    }
    return { suppress: false, reason: "material change since last prompt" };
  }
  return { suppress: false, reason: null };
}

/**
 * Zod source of truth for the adapter-event wire format. The JSON Schema
 * emitted to schemas/adapter-event-v0.1.json is generated from this
 * (scripts/emitSchemas.mjs); edit here, not there.
 */
export const AdapterEventSchema = z.object({
  harness: z.string().min(1),
  session_id: z.string().nullable().optional(),
  signals: z
    .object({
      contextPressure: z.number().min(0).max(1).nullable(),
      turnPressure: z.number().min(0).max(1).nullable(),
      elapsedPressure: z.number().min(0).max(1).nullable(),
      workBoundary: z.boolean().nullable(),
      handoffRequest: z.boolean().nullable(),
      changePressure: z.number().min(0).max(1).nullable(),
      stuckSignal: z.number().min(0).max(1).nullable(),
      resumeReadiness: z.number().min(0).max(1).nullable(),
      semanticPhaseChange: z.boolean().nullable(),
      unresolvedQuestions: z.number().min(0).max(1).nullable(),
      sessionAgePressure: z.number().min(0).max(1).nullable(),
    })
    .partial()
    .optional(),
  /** Material event names that can break prompt cooldown. */
  material_event: z.string().nullable().optional(),
  at: z.string().optional(),
}).passthrough(); // forward compatibility: unknown event fields are preserved (§7.1)

/** Event JSON accepted by `detect --event` and MCP handoff_detect. */
export interface AdapterEvent extends z.infer<typeof AdapterEventSchema> {}

/**
 * Evaluate an adapter event: normalize signals, score, and decide the
 * recommended action. Never creates records or terminates sessions.
 */
export function evaluateEvent(
  event: AdapterEvent,
  cfg: DetectorConfig,
  lastPromptAt: string | null,
  previousPressure: number | null,
  now: Date = new Date(),
): DetectorResult & {
  suppress: boolean;
  suppressReason: string | null;
  recommendedAction: "none" | "recommend" | "prepare";
} {
  // Normalize: copy provided signals, dropping explicit nulls so defaults
  // (false for booleans) survive. Schema fields are nullable for wire
  // flexibility, but DetectorSignals uses null only for unknown numbers.
  const signals: DetectorSignals = { ...nullSignals() };
  for (const [k, v] of Object.entries(event.signals ?? {})) {
    if (v === null || v === undefined) continue;
    (signals as unknown as Record<string, unknown>)[k] = v;
  }
  const result = detectHandoff(signals, cfg);
  const { suppress, reason } = shouldSuppressPrompt(
    lastPromptAt,
    previousPressure,
    result,
    cfg,
    now,
  );
  const recommendedAction = result.autoPrepare
    ? "prepare"
    : result.recommend
      ? "recommend"
      : "none";
  return { ...result, suppress, suppressReason: reason, recommendedAction };
}