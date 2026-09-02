import { describe, expect, it } from "vitest";
import { isUuid, shortId, uuidv7 } from "../src/ids.js";
import { filenameTimestamp, parseFilenameTimestamp } from "../src/time.js";
import { containedPath, isInsideRoot, sha256 } from "../src/paths.js";

describe("uuidv7", () => {
  it("generates valid, sortable, unique ids", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) {
      const id = uuidv7();
      expect(isUuid(id)).toBe(true);
      seen.add(id);
    }
    expect(seen.size).toBe(500);
  });

  it("encodes the timestamp (ms precision) in the first 48 bits", () => {
    const at = new Date("2026-09-02T14:30:00.123Z");
    const id = uuidv7(at);
    const hex = id.replace(/-/g, "").slice(0, 12);
    const ms = BigInt("0x" + hex);
    expect(Number(ms)).toBe(at.getTime());
  });

  it("is lexicographically sortable over time", () => {
    const a = uuidv7(new Date("2026-01-01T00:00:00Z"));
    const b = uuidv7(new Date("2027-01-01T00:00:00Z"));
    expect(a < b).toBe(true);
  });
});

describe("filename timestamps", () => {
  it("formats RFC 3339 with punctuation removed", () => {
    expect(filenameTimestamp("2026-09-02T14:30:00Z")).toBe("20260902T143000Z");
  });

  it("round-trips", () => {
    for (let d = 1; d <= 28; d++) {
      const iso = `2026-02-${String(d).padStart(2, "0")}T23:59:59Z`;
      const ts = filenameTimestamp(iso);
      expect(parseFilenameTimestamp(ts)!.toISOString()).toBe(new Date(iso).toISOString());
    }
  });

  it("shortId uses the random tail of the uuid", () => {
    expect(shortId("0198c0de-7000-7000-8000-000000000001")).toBe("00000001");
  });
});

describe("paths", () => {
  it("sha256 prefixes digest", () => {
    expect(sha256("x")).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("containment checks", () => {
    expect(isInsideRoot("/a/b", "/a/b/c")).toBe(true);
    expect(isInsideRoot("/a/b", "/a/b")).toBe(true);
    expect(isInsideRoot("/a/b", "/a/bc")).toBe(false);
    expect(isInsideRoot("/a/b", "../c")).toBe(false);
    expect(containedPath("/a/b", "c/d.ts")).toBe("c/d.ts");
    expect(containedPath("/a/b", "/a/b")).toBe(".");
    expect(containedPath("/a/b", "../out")).toBeNull();
  });
});
