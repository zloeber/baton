#!/usr/bin/env node
// Architecture lint for @baton/core: the domain library must stay free of
// MCP, terminal, vendor SDK, network, and canonical-data database dependencies.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const banned = [
  /from\s+["'](?:@baton\/(?:cli|mcp|adapter-sdk|adapter-generic)|commander|clipanion|yargs|better-sqlite3|node-sqlite3|sqlite3|@modelcontextprotocol\/sdk)["']/,
  /\b(?:require|import)\s*\(?\s*["'](?:@modelcontextprotocol|commander|better-sqlite3|sqlite3)["']/,
];

let violations = 0;
function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist") continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      walk(p);
    } else if (p.endsWith(".ts") || p.endsWith(".mjs") || p.endsWith(".js")) {
      const rel = relative(root, p);
      const text = readFileSync(p, "utf8");
      for (const rx of banned) {
        if (rx.test(text)) {
          console.error(`LINT VIOLATION in ${rel}: banned dependency pattern ${rx}`);
          violations++;
        }
      }
    }
  }
}
walk(root);
if (violations > 0) {
  console.error(`core lint failed with ${violations} violation(s)`);
  process.exit(1);
}
console.log("core lint: ok");
