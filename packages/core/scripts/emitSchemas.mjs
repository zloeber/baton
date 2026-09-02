#!/usr/bin/env node
// Emits JSON Schema documents from the Zod source of truth in src/.
//
// The checked-in files under schemas/ are GENERATED ARTIFACTS:
//   schemas/handoff-v0.1.json       <- src/schema.ts        HandoffSchema
//   schemas/config-v0.1.json        <- src/projectInit.ts   ConfigSchema
//   schemas/adapter-event-v0.1.json <- src/detect/index.ts  AdapterEventSchema
//
// Edit the Zod schemas, then run `pnpm --filter @baton/core emit:schemas`.
// `--check` fails when a checked-in file differs from what would be emitted
// (used by CI and `mise schemas-check`) so schemas can never drift.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import zodToJsonSchema from "zod-to-json-schema";

import { HandoffSchema, SCHEMA_ID, SCHEMA_VERSION } from "../dist/schema.js";
import { ConfigSchema } from "../dist/projectInit.js";
import { AdapterEventSchema } from "../dist/detect/index.js";

const coreRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const schemasDir = join(coreRoot, "..", "..", "schemas");

// Description attached by the legacy-name reader story (rename migration):
const legacyDescription =
  "Records written before the v0.1 rename may carry the legacy $schema id " +
  "https://threadline.dev/schemas/handoff/v0.1.json; both are valid for this " +
  "schema version.";

const LEGACY_SCHEMA_ID = "https://threadline.dev/schemas/handoff/v0.1.json";

const handoffOverrides = {
  $schema: z.union([
    z.literal(SCHEMA_ID),
    z.literal(LEGACY_SCHEMA_ID),
  ]),
};

function emit(schema, { title, description, overrides = {} } = {}) {
  let s = schema;
  if (Object.keys(overrides).length > 0) {
    const shape = { ...schema._def.shape(), ...overrides };
    s = z.object(shape).passthrough();
  }
  const doc = zodToJsonSchema(s, {
    name: "Baton",
    target: "draft-7",
    $refStrategy: "none",
    markDescriptions: true,
  });
  // zod-to-json-schema nests the named definition; hoist it to the document root.
  const def = doc.definitions?.Baton ?? doc;
  const out = {
    $schema: "http://json-schema.org/draft-07/schema#",
    ...(title ? { title } : {}),
    ...(description ? { description } : {}),
    ...def,
  };
  delete out.definitions;
  delete out.$ref;
  return out;
}

const TARGETS = [
  {
    file: "handoff-v0.1.json",
    schema: HandoffSchema,
    title: "Baton handoff",
    description: legacyDescription,
    overrides: handoffOverrides,
  },
  {
    file: "config-v0.1.json",
    schema: ConfigSchema,
    title: "Baton project config (.baton/config.json)",
    description:
      "Generated from ConfigSchema in packages/core/src/projectInit.ts. " +
      "Unknown fields pass through for forward compatibility.",
  },
  {
    file: "adapter-event-v0.1.json",
    schema: AdapterEventSchema,
    title: "Baton adapter event",
    description:
      "Event JSON accepted by `baton detect --event`, the MCP handoff_detect " +
      "tool, and the Hermes context-engine bridge. Generated from " +
      "AdapterEventSchema in packages/core/src/detect/index.ts.",
  },
];

function render(doc) {
  return JSON.stringify(doc, null, 2) + "\n";
}

// Compare newline-insensitively: a windows checkout with autocrlf=true materializes
// checked-in files with CRLF, which would false-alarm the byte-compare below.
// (.gitattributes pins LF in the repository; this guards local clones.)
function normalizeEol(s) {
  return s.replace(/\r\n/g, "\n");
}

const check = process.argv.includes("--check");
let drifted = 0;

for (const t of TARGETS) {
  const emitted = render(emit(t.schema, t));
  const path = join(schemasDir, t.file);
  if (check) {
    const current = normalizeEol(readFileSync(path, "utf8"));
    if (current !== normalizeEol(emitted)) {
      console.error(`SCHEMA DRIFT: ${t.file} differs from the Zod source of truth.`);
      console.error(`  run: mise schemas   (or pnpm --filter @baton/core emit:schemas)`);
      drifted++;
    } else {
      console.log(`schemas/${t.file}: up to date`);
    }
  } else {
    writeFileSync(path, emitted);
    console.log(`wrote schemas/${t.file}`);
  }
}

if (drifted > 0) {
  process.exit(1);
}
