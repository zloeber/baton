import { describe, expect, it } from "vitest";
import {
  LEGAL_TRANSITIONS,
  assertTransition,
  canTransition,
  TransitionError,
} from "../src/stateMachine.js";
import type { HandoffStatus } from "../src/schema.js";

describe("state machine", () => {
  const cases: [HandoffStatus, HandoffStatus, boolean][] = [
    ["draft", "validated", true],
    ["draft", "ready", true],
    ["validated", "ready", true],
    ["validated", "draft", true],
    ["ready", "resumed", true],
    ["ready", "superseded", true],
    ["ready", "archived", true],
    ["ready", "draft", false],
    ["ready", "validated", false],
    ["resumed", "draft", false],
    ["superseded", "draft", false],
    ["superseded", "ready", false],
    ["archived", "ready", false],
    ["archived", "draft", false],
  ];

  for (const [from, to, ok] of cases) {
    it(`${from} -> ${to} is ${ok ? "legal" : "illegal"}`, () => {
      expect(canTransition(from, to)).toBe(ok);
      if (ok) {
        expect(() => assertTransition(from, to)).not.toThrow();
      } else {
        expect(() => assertTransition(from, to)).toThrow(TransitionError);
      }
    });
  }

  it("archived is terminal", () => {
    expect(LEGAL_TRANSITIONS.archived).toEqual(["archived"]);
  });

  it("superseding a ready record is the documented path after continuation", () => {
    // ready -> superseded is legal (spec §14); the superseding child carries lineage.
    expect(canTransition("ready", "superseded")).toBe(true);
  });
});
