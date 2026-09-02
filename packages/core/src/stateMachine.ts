import { Handoff, HandoffStatus } from "./schema.js";

export const LEGAL_TRANSITIONS: Record<HandoffStatus, HandoffStatus[]> = {
  draft: ["draft", "validated", "ready"],
  validated: ["validated", "ready", "draft"],
  ready: ["ready", "resumed", "superseded", "archived"],
  resumed: ["resumed", "superseded", "archived"],
  superseded: ["superseded", "archived"],
  archived: ["archived"],
};

export class TransitionError extends Error {
  readonly code = "TRANSITION";
  constructor(from: HandoffStatus, to: HandoffStatus, why: string) {
    super(`illegal transition ${from} -> ${to}: ${why}`);
    this.name = "TransitionError";
  }
}

export function canTransition(from: HandoffStatus, to: HandoffStatus): boolean {
  return LEGAL_TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertTransition(from: HandoffStatus, to: HandoffStatus): void {
  if (!canTransition(from, to)) {
    throw new TransitionError(
      from,
      to,
      LEGAL_TRANSITIONS[from].length === 0
        ? `${from} is terminal`
        : `legal next states from ${from}: ${LEGAL_TRANSITIONS[from].join(", ")}`,
    );
  }
}

/** Apply + persist a transition (keeps validation block intact). */
export function transitionHandoff(h: Handoff, to: HandoffStatus, now = new Date()): Handoff {
  assertTransition(h.status, to);
  return { ...h, status: to, updated_at: now.toISOString() };
}
