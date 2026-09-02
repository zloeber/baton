#!/usr/bin/env node
// MCP package lint: only the official SDK may be imported from MCP space;
// no generic shell execution tool may be registered.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const banned = [/from\s+["'](?:@baton\/(?:cli)|openai|@anthropic-ai)["']/];
const shellToolBan = /name:\s*["'](?:shell|bash|exec|execute_command)["']/;

let violations = 0;
function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist") continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith(".ts")) {
      const rel = relative(root, p);
      const text = readFileSync(p, "utf8");
      for (const rx of banned) {
        if (rx.test(text)) {
          console.error(`LINT VIOLATION in ${rel}: banned dependency ${rx}`);
          violations++;
        }
      }
      if (shellToolBan.test(text)) {
        console.error(`LINT VIOLATION in ${rel}: generic shell tools are not allowed (spec §13)`);
        violations++;
      }
    }
  }
}
walk(root);
if (violations > 0) {
  console.error(`mcp lint failed with ${violations} violation(s)`);
  process.exit(1);
}
console.log("mcp lint: ok");
