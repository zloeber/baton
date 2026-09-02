import { describe, expect, it } from "vitest";
import {
  DetectorSignals,
  detectHandoff,
  evaluateEvent,
  nullSignals,
  shouldSuppressPrompt,
} from "../src/detect/index.js";
import { defaultConfig } from "../src/projectInit.js";

const cfg = defaultConfig().detector;

function signals(over: Partial<DetectorSignals> = {}): DetectorSignals {
  return { ...nullSignals(), ...over };
}

describe("pressure scoring (spec §9.2)", () => {
  const table: { name: string; s: DetectorSignals; pressure: number }[] = [
    { name: "nulls only -> 0", s: signals(), pressure: 0 },
    { name: "explicit request -> 1.0", s: signals({ handoffRequest: true }), pressure: 1.0 },
    { name: "context 0.9 -> 0.63", s: signals({ contextPressure: 0.9 }), pressure: 0.63 },
    {
      name: "resource composite",
      s: signals({ contextPressure: 0.9, turnPressure: 1, elapsedPressure: 1, changePressure: 1 }),
      pressure: 0.7 * 0.9 + 0.15 + 0.1 + 0.05,
    },
    {
      name: "stuck composite",
      s: signals({ stuckSignal: 1, workBoundary: true, changePressure: 1 }),
      pressure: 0.6 + 0.25 + 0.05,
    },
    { name: "boundary alone small", s: signals({ workBoundary: true }), pressure: 0.25 },
    {
      name: "max of composites",
      s: signals({ contextPressure: 1, stuckSignal: 0.5 }),
      pressure: Math.max(0.7, 0.3),
    },
  ];

  for (const { name, s, pressure } of table) {
    it(name, () => {
      const r = detectHandoff(s, cfg);
      expect(r.pressure).toBeCloseTo(pressure, 5);
    });
  }

  it("unavailable signals are plainly reported as unused", () => {
    const r = detectHandoff(signals({ contextPressure: 0.5 }), cfg);
    const turn = r.inputs.find((i) => i.key === "turnPressure")!;
    expect(turn.used).toBe(false);
    const ctx = r.inputs.find((i) => i.key === "contextPressure")!;
    expect(ctx.used).toBe(true);
    expect(ctx.value).toBe(0.5);
  });

  it("reasons always explain the outcome", () => {
    const r = detectHandoff(signals(), cfg);
    expect(r.reasons).toEqual(["no available pressure signals"]);
    const r2 = detectHandoff(signals({ handoffRequest: true }), cfg);
    expect(r2.reasons).toContain("explicit handoff request");
  });

  it("phase/unresolved composite: 0.35*phase + 0.30*unresolved (improvement plan §8)", () => {
    const r = detectHandoff(signals({ semanticPhaseChange: true, unresolvedQuestions: 1 }), cfg);
    expect(r.pressure).toBeCloseTo(0.65, 5);
    expect(r.reasons.some((x) => x.includes("phase"))).toBe(true);
  });

  it("semantic phase change alone stays below recommend", () => {
    const r = detectHandoff(signals({ semanticPhaseChange: true }), cfg);
    expect(r.pressure).toBeCloseTo(0.35, 5);
    expect(r.recommend).toBe(false);
  });

  it("session age contributes its own term", () => {
    const r = detectHandoff(signals({ sessionAgePressure: 1 }), cfg);
    expect(r.pressure).toBeCloseTo(0.2, 5);
    expect(r.reasons.some((x) => x.includes("session age"))).toBe(true);
  });

  it("new signals are reported with used/unused status", () => {
    const r = detectHandoff(signals({ semanticPhaseChange: true, sessionAgePressure: 0.5 }), cfg);
    expect(r.inputs.find((i) => i.key === "semanticPhaseChange")!.used).toBe(true);
    expect(r.inputs.find((i) => i.key === "sessionAgePressure")!.used).toBe(true);
    expect(r.inputs.find((i) => i.key === "unresolvedQuestions")!.used).toBe(false);
  });
});

describe("recommend / auto_prepare thresholds (§9.2)", () => {
  it("recommend at pressure >= 0.70", () => {
    expect(detectHandoff(signals({ contextPressure: 1 }), cfg).recommend).toBe(true); // 0.70
    expect(detectHandoff(signals({ contextPressure: 0.99 }), cfg).recommend).toBe(false); // 0.693
  });

  it("auto_prepare requires 0.85 pressure and 0.80 readiness", () => {
    const high = signals({ contextPressure: 1, turnPressure: 1, elapsedPressure: 1, changePressure: 1 });
    expect(detectHandoff({ ...high, resumeReadiness: 0.9 }, cfg).autoPrepare).toBe(true);
    expect(detectHandoff({ ...high, resumeReadiness: 0.5 }, cfg).autoPrepare).toBe(false);
    expect(detectHandoff({ ...high, resumeReadiness: null }, cfg).autoPrepare).toBe(false);
  });

  it("explicit request always recommends regardless of other nulls", () => {
    const r = detectHandoff(signals({ handoffRequest: true }), cfg);
    expect(r.recommend).toBe(true);
    expect(r.pressure).toBe(1);
  });
});

describe("cooldown / suppression (§9.2)", () => {
  const now = new Date("2026-09-02T12:00:00Z");
  const high = detectHandoff(signals({ contextPressure: 1 }), cfg);

  it("suppresses repeated prompts within 20 minutes", () => {
    const { suppress, reason } = shouldSuppressPrompt(
      "2026-09-02T11:50:00Z",
      0.7,
      high,
      cfg,
      now,
    );
    expect(suppress).toBe(true);
    expect(reason).toContain("cooldown");
  });

  it("allows prompts after the cooldown window", () => {
    const { suppress } = shouldSuppressPrompt("2026-09-02T11:00:00Z", 0.7, high, cfg, now);
    expect(suppress).toBe(false);
  });

  it("material change (score jump) breaks cooldown", () => {
    const { suppress, reason } = shouldSuppressPrompt(
      "2026-09-02T11:50:00Z",
      0.3,
      high,
      cfg,
      now,
    );
    expect(suppress).toBe(false);
    expect(reason).toContain("material change");
  });

  it("explicit request breaks cooldown", () => {
    const explicit = detectHandoff(signals({ handoffRequest: true }), cfg);
    const { suppress } = shouldSuppressPrompt("2026-09-02T11:59:00Z", 1.0, explicit, cfg, now);
    expect(suppress).toBe(false);
  });
});

describe("evaluateEvent (adapter events)", () => {
  it("recommends prepare for a high-pressure ready event", () => {
    const r = evaluateEvent(
      { harness: "generic", signals: { contextPressure: 1, turnPressure: 1, elapsedPressure: 1, changePressure: 1, resumeReadiness: 0.9 } },
      cfg,
      null,
      null,
    );
    expect(r.recommendedAction).toBe("prepare");
    expect(r.pressure).toBeCloseTo(1.0, 5);
  });

  it("does not nag on low signals", () => {
    const r = evaluateEvent({ harness: "generic", signals: { contextPressure: 0.2 } }, cfg, null, null);
    expect(r.recommendedAction).toBe("none");
    expect(r.suppress).toBe(false);
  });

  it("suppression state is surfaced, not hidden", () => {
    const r = evaluateEvent({ harness: "generic", signals: { contextPressure: 1 } }, cfg, new Date(Date.now() - 60_000).toISOString(), 0.7, new Date());
    expect(r.suppress).toBe(true);
    expect(r.suppressReason).toBeTruthy();
  });
});
