import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Ajv as AjvClass, type Ajv } from "ajv";
import * as ajvFormatsModule from "ajv-formats";
const addFormats = ajvFormatsModule.default as unknown as typeof ajvFormatsModule.default | undefined;
import { SCHEMA_ID, SCHEMA_VERSION } from "../src/schema.js";
import { ConfigSchema, defaultConfig } from "../src/projectInit.js";

const repoRoot = join(__dirname, "..", "..", "..");
const schemaPath = (name: string) => join(repoRoot, "schemas", name);

/** Compile a schema with ajv + formats, so uuid/date-time are enforced. */
function ajvFor(schemaFile: string) {
  const ajv = new AjvClass({
    strict: false, // generated schemas rely on format keywords, not type-space
    allErrors: true,
  });
  (addFormats as unknown as (a: Ajv) => Ajv)(ajv);
  return ajv.compile(JSON.parse(readFileSync(schemaPath(schemaFile), "utf8")));
}

describe("generated schemas validate the source-of-truth fixtures", () => {
  it("fixture handoff-ready.json validates against schemas/handoff-v0.1.json", () => {
    const validate = ajvFor("handoff-v0.1.json");
    const doc = JSON.parse(
      readFileSync(join(repoRoot, "tests", "fixtures", "handoff-ready.json"), "utf8"),
    );
    const ok = validate(doc);
    if (!ok) {
      throw new Error(
        `fixture failed schema validation: ${JSON.stringify(validate.errors, null, 2)}`,
      );
    }
    expect(ok).toBe(true);
  });

  it("example handoff validates against schemas/handoff-v0.1.json", () => {
    const validate = ajvFor("handoff-v0.1.json");
    const doc = JSON.parse(
      readFileSync(join(repoRoot, "examples", "handoff-ready.json"), "utf8"),
    );
    const ok = validate(doc);
    if (!ok) {
      throw new Error(
        `example failed schema validation: ${JSON.stringify(validate.errors, null, 2)}`,
      );
    }
    expect(ok).toBe(true);
  });

  it("example adapter events validate against schemas/adapter-event-v0.1.json", () => {
    const validate = ajvFor("adapter-event-v0.1.json");
    const events = JSON.parse(
      readFileSync(join(repoRoot, "examples", "adapter-events", "events.json"), "utf8"),
    ) as Array<{ event: unknown }>;
    expect(events.length).toBeGreaterThan(0);
    for (const { event } of events) {
      const ok = validate(event);
      if (!ok) {
        throw new Error(
          `event failed schema validation: ${JSON.stringify(validate.errors, null, 2)}`,
        );
      }
    }
  });

  it("example config validates against schemas/config-v0.1.json", () => {
    const validate = ajvFor("config-v0.1.json");
    const doc = JSON.parse(
      readFileSync(
        join(repoRoot, "examples", "minimal-project", ".baton", "config.json"),
        "utf8",
      ),
    );
    const ok = validate(doc);
    if (!ok) {
      throw new Error(
        `config failed schema validation: ${JSON.stringify(validate.errors, null, 2)}`,
      );
    }
    expect(ok).toBe(true);
  });

  it("rejects malformed handoffs (bad id, bad status, bad structured ids)", () => {
    const validate = ajvFor("handoff-v0.1.json");
    const doc = JSON.parse(
      readFileSync(join(repoRoot, "tests", "fixtures", "handoff-ready.json"), "utf8"),
    );

    const badId = { ...doc, id: "not-a-uuid" };
    expect(validate(badId)).toBe(false);

    const badStatus = { ...doc, status: "finished" };
    expect(validate(badStatus)).toBe(false);

    const badDecisionId = JSON.parse(JSON.stringify(doc));
    badDecisionId.decisions[0].id = "D-1";
    expect(validate(badDecisionId)).toBe(false);
  });

  it("accepts the legacy threadline $schema id (rename transition)", () => {
    const validate = ajvFor("handoff-v0.1.json");
    const doc = JSON.parse(
      readFileSync(join(repoRoot, "tests", "fixtures", "handoff-ready.json"), "utf8"),
    );
    const legacy = { ...doc, $schema: "https://threadline.dev/schemas/handoff/v0.1.json" };
    expect(validate(legacy)).toBe(true);
  });
});

describe("generated schemas mirror the Zod source of truth", () => {
  it("handoff schema is passthrough and version-consistent", () => {
    const doc = JSON.parse(readFileSync(schemaPath("handoff-v0.1.json"), "utf8"));
    expect(doc.additionalProperties).toBe(true);
    expect(SCHEMA_VERSION).toBe("0.1");
    expect(doc.properties.$schema.enum).toContain(SCHEMA_ID);
  });

  it("adapter-event schema is passthrough", () => {
    const doc = JSON.parse(readFileSync(schemaPath("adapter-event-v0.1.json"), "utf8"));
    expect(doc.additionalProperties).toBe(true);
  });

  it("config schema exposes detector defaults and passthrough posture", () => {
    const doc = JSON.parse(readFileSync(schemaPath("config-v0.1.json"), "utf8"));
    expect(doc.additionalProperties).toBe(true);
    const cfg = defaultConfig();
    const ajv = new AjvClass({ strict: false, allErrors: true });
    // Round-trip: the Zod default config must satisfy the emitted schema.
    const validate = ajv.compile(doc);
    expect(validate(cfg)).toBe(true);
    expect(ConfigSchema.safeParse(cfg).success).toBe(true);
  });

  it("emission is idempotent (checked-in file == fresh emit; --check mode passes)", () => {
    const before = readFileSync(schemaPath("handoff-v0.1.json"), "utf8");
    execFileSync("node", [join(repoRoot, "packages", "core", "scripts", "emitSchemas.mjs"), "--check"], {
      stdio: "pipe",
    });
    // --check exits non-zero on any drift; reaching here means all three files match.
    const after = readFileSync(schemaPath("handoff-v0.1.json"), "utf8");
    expect(after).toBe(before);
  });
});
