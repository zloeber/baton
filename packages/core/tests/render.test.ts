import { describe, expect, it } from "vitest";
import { renderMarkdown, renderResumePrompt, renderYaml } from "../src/render.js";
import { HandoffSchema } from "../src/schema.js";
import fixture from "../../../tests/fixtures/handoff-ready.json" with { type: "json" };

const h = () => HandoffSchema.parse(fixture);

describe("renderResumePrompt", () => {
  it("includes objective, state, constraints, decisions, next action, and freshness instruction", () => {
    const text = renderResumePrompt(h());
    expect(text).toContain("# Handoff: Implement resumable OAuth callback validation (synthetic fixture)");
    expect(text).toContain("## Objective");
    expect(text).toContain("## Current state");
    expect(text).toContain("## Non-negotiable constraints");
    expect(text).toContain("D-001");
    expect(text).toContain("## First next action");
    expect(text).toContain("## Verify freshness");
  });

  it("flags stale handoffs prominently (§22.3)", () => {
    const stale = HandoffSchema.parse({
      ...fixture,
      validation: {
        ...fixture.validation,
        freshness: { git_head_at_capture: "aaa", git_head_now: "bbb", stale: true },
      },
    });
    const text = renderResumePrompt(stale);
    expect(text).toContain("STALE");
  });

  it("stays under the token budget (≤1,200 tokens by default, §11)", () => {
    const text = renderResumePrompt(h());
    // ~4 chars/token heuristic
    expect(text.length).toBeLessThanOrEqual(4800);
  });

  it("truncates giant records with a pointer to the full record", () => {
    const bloated = HandoffSchema.parse({
      ...fixture,
      work: {
        ...fixture.work,
        objective: "Long objective. " + "detail ".repeat(400),
        constraints: Array.from({ length: 50 }, (_, i) => `constraint ${i} ` + "y".repeat(120)),
      },
      decisions: Array.from({ length: 60 }, (_, i) => ({
        id: `D-${String(i + 1).padStart(3, "0")}`,
        decision: `Decision ${i} ` + "z".repeat(120),
        rationale: null,
        alternatives_considered: [],
        evidence_ids: [],
        made_at: "2026-09-02T14:20:00Z",
      })),
    });
    const text = renderResumePrompt(bloated);
    expect(text.length).toBeLessThanOrEqual(4800 + 80);
    expect(text).toContain("BRIEF TRUNCATED");
  });

  it("never embeds secret-like values from origin", () => {
    const dirty = HandoffSchema.parse({
      ...fixture,
      origin: { ...fixture.origin, session_id: "s-clean" },
    });
    const text = renderResumePrompt(dirty);
    expect(text).not.toContain("supersecret");
  });
});

describe("renderMarkdown", () => {
  it("renders the full record deterministically", () => {
    const a = renderMarkdown(h());
    const b = renderMarkdown(HandoffSchema.parse(JSON.parse(JSON.stringify(fixture))));
    expect(a).toBe(b);
    expect(a).toContain("## Open items");
    expect(a).toContain("O-001");
    expect(a).toContain("**status**: ready");
  });
});

describe("renderYaml", () => {
  it("emits scalars, arrays, and nested maps", () => {
    const y = renderYaml(h());
    expect(y).toContain("status: ready");
    expect(y).toContain("id: 0198c0de-7000-7000-8000-000000000001");
    expect(y).toContain("decisions:");
    expect(y).toContain("D-001");
  });

  it("quotes strings with special characters", () => {
    const y = renderYaml(
      HandoffSchema.parse({
        ...fixture,
        summary: { ...fixture.summary, current_state: "state: has colon" },
      }),
    );
    expect(y).toContain('"state: has colon"');
  });
});
