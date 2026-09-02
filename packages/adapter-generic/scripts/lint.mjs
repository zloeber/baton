#!/usr/bin/env node
const banned = [/from\s+["'](?:openai|@anthropic-ai|@modelcontextprotocol|cursor|gemini)["']/];
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
const root = new URL("..", import.meta.url).pathname;
let violations = 0;
function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist") continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith(".ts")) {
      const text = readFileSync(p, "utf8");
      if (banned.some((rx) => rx.test(text))) {
        console.error(`LINT VIOLATION in ${relative(root, p)}: vendor SDKs are not allowed`);
        violations++;
      }
    }
  }
}
walk(root);
if (violations > 0) process.exit(1);
console.log("adapter-generic lint: ok");
