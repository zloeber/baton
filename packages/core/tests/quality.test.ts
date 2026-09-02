import { describe, expect, it } from "vitest";
import { scoreQuality, formatQuality } from "../src/quality.js";
import { HandoffSchema } from "../src/schema.js";
import fixture from "../../../tests/fixtures/handoff-ready.json" with { type: "json" };

const h = () => HandoffSchema.parse(fixture);

describe("scoreQuality (improvement plan §7)", () => {
  it("returns deterministic scores for the canonical fixture", () => {
    const a = scoreQuality(h());
    const b = scoreQuality(h());
    expect(a).toEqual(b);
    expect(a.overall).toBeGreaterThan(0);
    expect(a.overall).toBeLessThanOrEqual(100);
  });

  it("scores every documented dimension 0-100 with a detail string", () => {
    const q = scoreQuality(h());
    const keys = q.dimensions.map((d) => d.key);
    expect(keys).toEqual([
      "objective_clarity",
      "current_state_clarity",
      "decision_completeness",
      "evidence_coverage",
      "artifact_coverage",
      "failed_attempts",
      "next_action_clarity",
      "freshness",
    ]);
    for (const d of q.dimensions) {
      expect(d.score).toBeGreaterThanOrEqual(0);
      expect(d.score).toBeLessThanOrEqual(100);
      expect(d.detail.length).toBeGreaterThan(0);
    }
  });

  it("overall is the mean of the dimensions", () => {
    const q = scoreQuality(h());
    const mean = q.dimensions.reduce((s, d) => s + d.score, 0) / q.dimensions.length;
    expect(q.overall).toBe(Math.round(mean));
  });

  it("penalizes an empty objective", () => {
    const empty = HandoffSchema.parse({
      ...fixture,
      work: { ...fixture.work, objective: "x" },
    });
    const fresh = scoreQuality(empty).dimensions.find((d) => d.key === "objective_clarity")!;
    const full = scoreQuality(h()).dimensions.find((d) => d.key === "objective_clarity")!;
    expect(fresh.score).toBeLessThan(full.score);
  });

  it("rewards decisions that carry evidence and rationale", () => {
    const backed = HandoffSchema.parse({
      ...fixture,
      decisions: [
        {
          id: "D-001",
          decision: "Use timing-safe comparison (fixture).",
          rationale: "Secret-derived values (fixture).",
          alternatives_considered: [],
          evidence_ids: ["E-001"],
          made_at: "2026-09-02T14:20:00Z",
        },
      ],
    });
    const bare = HandoffSchema.parse({
      ...fixture,
      decisions: [
        {
          id: "D-001",
          decision: "Use timing-safe comparison (fixture).",
          rationale: null,
          alternatives_considered: [],
          evidence_ids: [],
          made_at: "2026-09-02T14:20:00Z",
        },
      ],
    });
    expect(
      scoreQuality(backed).dimensions.find((d) => d.key === "evidence_coverage")!.score,
    ).toBeGreaterThan(
      scoreQuality(bare).dimensions.find((d) => d.key === "evidence_coverage")!.score,
    );
  });

  it("rewards recorded failed attempts (negative knowledge)", () => {
    const withFailures = scoreQuality(h()).dimensions.find((d) => d.key === "failed_attempts")!;
    expect(withFailures.score).toBe(100);
    const without = HandoffSchema.parse({ ...fixture, failed_attempts: [] });
    expect(
      scoreQuality(without).dimensions.find((d) => d.key === "failed_attempts")!.score,
    ).toBeLessThan(100);
  });

  it("downgrades stale freshness", () => {
    const stale = HandoffSchema.parse({
      ...fixture,
      validation: {
        ...fixture.validation,
        freshness: { git_head_at_capture: "a", git_head_now: "b", stale: true },
      },
    });
    expect(scoreQuality(stale).dimensions.find((d) => d.key === "freshness")!.score).toBe(25);
  });

  it("formats a one-line summary naming the weakest dimension", () => {
    const line = formatQuality(scoreQuality(h()));
    expect(line).toMatch(/^continuity \d+\/100 \(weakest: [a-z_]+ \d+\)$/);
  });
});
