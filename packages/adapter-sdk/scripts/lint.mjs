#!/usr/bin/env node
const banned = [/from\s+["'](?!@baton\/core|node:)/];
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
// fileURLToPath, not .pathname: .pathname yields "/D:/..." on Windows.
const root = fileURLToPath(new URL("..", import.meta.url));
let violations = 0;
function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist") continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith(".ts")) {
      const text = readFileSync(p, "utf8");
      if (banned.some((rx) => rx.test(text))) {
        console.error(`LINT VIOLATION in ${relative(root, p)}: adapter-sdk stays interface-only`);
        violations++;
      }
    }
  }
}
walk(root);
if (violations > 0) process.exit(1);
console.log("adapter-sdk lint: ok");
