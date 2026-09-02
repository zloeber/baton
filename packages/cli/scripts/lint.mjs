#!/usr/bin/env node
// CLI lint: keep the exit-code contract centralized and forbid vendor SDKs.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

// fileURLToPath, not .pathname: .pathname yields "/D:/..." on Windows and fs
// calls throw ENOENT with a doubled drive path.
const root = fileURLToPath(new URL("..", import.meta.url));
const banned = [
  /from\s+["'](?:@modelcontextprotocol|@anthropic-ai|openai|cursor|gemini)["']/,
];
const required = [
  { file: "src/exitCodes.ts", pattern: /USER|VALIDATION|NOT_FOUND|POLICY/ },
];

let violations = 0;
function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist") continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith(".ts") || p.endsWith(".mjs")) {
      const rel = relative(root, p);
      const text = readFileSync(p, "utf8");
      for (const rx of banned) {
        if (rx.test(text)) {
          console.error(`LINT VIOLATION in ${rel}: banned dependency ${rx}`);
          violations++;
        }
      }
    }
  }
}
walk(root);
for (const { file, pattern } of required) {
  const p = join(root, file);
  try {
    if (!pattern.test(readFileSync(p, "utf8"))) {
      console.error(`LINT VIOLATION: ${file} must define the documented exit-code constants`);
      violations++;
    }
  } catch {
    console.error(`LINT VIOLATION: missing ${file}`);
    violations++;
  }
}
if (violations > 0) {
  console.error(`cli lint failed with ${violations} violation(s)`);
  process.exit(1);
}
console.log("cli lint: ok");
