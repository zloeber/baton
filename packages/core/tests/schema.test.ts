import { describe, expect, it } from "vitest";
import {
  HandoffSchema,
  checkDraftRequirements,
  checkReadinessRequirements,
  SCHEMA_VERSION,
} from "../src/schema.js";
import fixture from "../../../tests/fixtures/handoff-ready.json" with { type: "json" };

const valid = fixture as unknown as Record<string, unknown>;

function clone(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...JSON.parse(JSON.stringify(valid)), ...over } as Record<string, unknown>;
}

describe("HandoffSchema", () => {
  it("parses the committed ready fixture", () => {
    const parsed = HandoffSchema.parse(valid);
    expect(parsed.id).toBe("0198c0de-7000-7000-8000-000000000001");
    expect(parsed.status).toBe("ready");
  });

  it("preserves unknown top-level and nested fields (forward compat, §7.1)", () => {
    const withUnknown = clone({
      future_field: { nested: [1, 2, 3] },
      project: { ...(valid.project as Record<string, unknown>), future_repo_field: "x" },
    });
    const parsed = HandoffSchema.parse(withUnknown);
    expect((parsed as Record<string, unknown>)["future_field"]).toEqual({ nested: [1, 2, 3] });
    expect(parsed.project["future_repo_field" as keyof typeof parsed.project]).toBe("x");
  });

  it("rejects an invalid status enum", () => {
    expect(() => HandoffSchema.parse(clone({ status: "published" }))).toThrow();
  });

  it("rejects a malformed id", () => {
    expect(() => HandoffSchema.parse(clone({ id: "not-a-uuid" }))).toThrow();
  });

  it("rejects non-timestamp strings in date fields", () => {
    expect(() => HandoffSchema.parse(clone({ created_at: "yesterday" }))).toThrow();
  });

  it("rejects bad structured ids", () => {
    const broken = clone();
    (broken.decisions as { id: string }[])[0]!.id = "decision-1";
    expect(() => HandoffSchema.parse(broken)).toThrow(/structured ids/);
  });

  it("round-trips through JSON without loss", () => {
    const parsed = HandoffSchema.parse(valid);
    const again = HandoffSchema.parse(JSON.parse(JSON.stringify(parsed)));
    expect(again).toEqual(parsed);
  });

  it("exposes the canonical schema version", () => {
    expect(SCHEMA_VERSION).toBe("0.1");
  });
});

describe("requirements helpers", () => {
  it("flags missing draft requirements", () => {
    const parsed = HandoffSchema.parse(valid);
    const mutated = {
      ...parsed,
      work: { ...parsed.work, title: "", objective: "" },
      summary: { ...parsed.summary, current_state: "" },
    } as unknown as typeof parsed;
    const missing = checkDraftRequirements(mutated);
    expect(missing).toContain("work.title");
    expect(missing).toContain("work.objective");
    expect(missing).toContain("summary.current_state");
  });

  it("ready requires actionable open item or completed state", () => {
    const noOpen = HandoffSchema.parse(
      clone({
        open_items: [],
        summary: { ...(valid.summary as Record<string, unknown>), completed: [] },
      }),
    );
    expect(checkReadinessRequirements(noOpen).length).toBeGreaterThan(0);

    const withOpen = HandoffSchema.parse(valid);
    expect(checkReadinessRequirements(withOpen)).toEqual([]);
  });

  it("ready requires validation pass/warn", () => {
    const h = HandoffSchema.parse(
      clone({
        validation: { ...(valid.validation as Record<string, unknown>), status: "not_run" },
      }),
    );
    const problems = checkReadinessRequirements(h);
    expect(problems.some((p) => p.includes("validation.status"))).toBe(true);
  });

  it("ready blocks flagged records", () => {
    const h = HandoffSchema.parse(clone({ flags: ["invalid"] }));
    expect(checkReadinessRequirements(h).some((p) => p.includes("invalid"))).toBe(true);
  });
});
