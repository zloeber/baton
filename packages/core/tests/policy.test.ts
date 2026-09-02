import { describe, expect, it } from "vitest";
import {
  REDACTED,
  auditHandoff,
  checkPathContainment,
  compileSecretPatterns,
  findTranscriptFields,
  opaqueSessionId,
  redactDocument,
  referencedPaths,
} from "../src/policy.js";
import { HandoffSchema } from "../src/schema.js";
import fixture from "../../../tests/fixtures/handoff-ready.json" with { type: "json" };

describe("secret redaction", () => {
  const patterns = [
    "(?i)(api[_-]?key|secret|token)\\s*[:=]\\s*\\S+",
    "ghp_[A-Za-z0-9]{20,}",
    "sk-[A-Za-z0-9_-]{20,}",
    "-----BEGIN (?:RSA )?PRIVATE KEY-----",
  ];

  it("redacts secret-like strings and records only field paths", () => {
    const { doc, redactions } = redactDocument(
      {
        summary: { current_state: "token: supersecret123 was used" },
        nested: { deep: "api_key = abc123" },
        list: ["sk-proj-abcdefghijklmnopqrs", "clean"],
      },
      patterns,
    );
    const d = doc as { summary: { current_state: string }; nested: { deep: string }; list: string[] };
    expect(d.summary.current_state).toContain(REDACTED);
    expect(d.summary.current_state).not.toContain("supersecret123");
    expect(d.nested.deep).toContain(REDACTED);
    expect(d.list[0]).toBe(REDACTED);
    expect(d.list[1]).toBe("clean");
    expect(redactions.map((r) => r.field)).toEqual([
      "summary.current_state",
      "nested.deep",
      "list[0]",
    ]);
    expect(JSON.stringify(redactions)).not.toContain("supersecret123");
  });

  it("never rewrites the redactions ledger itself", () => {
    const { doc } = redactDocument(
      { redactions: [{ field: "x", reason: "matched secret policy", replacement: "[REDACTED]" }] },
      patterns,
    );
    expect((doc as { redactions: unknown[] }).redactions).toHaveLength(1);
  });

  it("flags invalid regex patterns explicitly", () => {
    const { regexes, invalid } = compileSecretPatterns(["([unclosed", "(?i)token"]);
    expect(regexes).toHaveLength(1);
    expect(invalid).toEqual(["([unclosed"]);
  });

  it("finds transcript-bearing fields anywhere (§16)", () => {
    const violations = findTranscriptFields({
      summary: {},
      messages: [{ role: "user" }],
      deep: { chat_history: "..." },
    });
    expect(violations.map((v) => v.field)).toEqual(["messages", "deep.chat_history"]);
  });

  it("does not flag the fixture", () => {
    expect(findTranscriptFields(fixture)).toEqual([]);
  });
});

describe("path containment", () => {
  const root = "/tmp/project";
  it("accepts in-root relative paths", () => {
    const v = checkPathContainment(root, [{ field: "artifacts[0].path", path: "src/a.ts" }]);
    expect(v).toEqual([]);
  });
  it("rejects traversal", () => {
    const v = checkPathContainment(root, [{ field: "f", path: "../secrets.env" }]);
    expect(v).toEqual([{ field: "f", path: "../secrets.env", reason: "traversal" }]);
  });
  it("rejects absolute out-of-root paths", () => {
    const v = checkPathContainment(root, [{ field: "f", path: "/etc/passwd" }]);
    expect(v).toEqual([{ field: "f", path: "/etc/passwd", reason: "outside-root" }]);
  });
  it("allows explicitly configured extra roots", () => {
    const v = checkPathContainment(
      root,
      [{ field: "f", path: "/tmp/shared/a.ts" }],
      ["/tmp/shared"],
    );
    expect(v).toEqual([]);
  });
});

describe("referenced path collection", () => {
  it("collects artifact paths and file evidence refs", () => {
    const h = HandoffSchema.parse(fixture);
    const refs = referencedPaths(h);
    expect(refs).toContainEqual({ field: "artifacts[0].path", path: "src/auth/callback.ts" });
    expect(refs.find((r) => r.field.startsWith("evidence"))).toBeUndefined(); // test evidence ref is a command, not a file
  });
});

describe("session id opaquing", () => {
  it("hashes externally supplied ids by default", () => {
    const out = opaqueSessionId("user@example.com-session-42", true);
    expect(out).not.toContain("user@example.com");
    expect(out).toMatch(/^s-[0-9a-f]{16}$/);
  });
  it("passes through when hashing disabled", () => {
    expect(opaqueSessionId("abc", false)).toBe("abc");
  });
});

describe("audit", () => {
  it("enumerates fields, redactions, and refs without values", () => {
    const h = HandoffSchema.parse({
      ...fixture,
      redactions: [{ field: "evidence[0].ref", reason: "matched secret policy", replacement: "[REDACTED]" }],
    });
    const report = auditHandoff(h);
    expect(report.field_counts.decisions).toBe(1);
    expect(report.redactions[0]!.field).toBe("evidence[0].ref");
    expect(report.local_paths).toContain("src/auth/callback.ts");
    expect(report.transcript_fields).toEqual([]);
    expect(JSON.stringify(report)).not.toContain("supersecret");
  });
});
