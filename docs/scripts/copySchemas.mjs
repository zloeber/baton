// Copies generated JSON Schemas from ../schemas into ./public/schemas so the
// built site serves them verbatim and reference pages can link to them.
// Run automatically via predev/prebuild; safe to run standalone.
import { copyFileSync, mkdirSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "..", "..", "schemas");
const out = join(here, "..", "public", "schemas");

mkdirSync(out, { recursive: true });
for (const f of readdirSync(src)) {
  if (f.endsWith(".json")) copyFileSync(join(src, f), join(out, f));
}
console.log(`[docs] copied schemas from ${src} -> ${out}`);
