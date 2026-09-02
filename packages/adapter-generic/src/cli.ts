#!/usr/bin/env node
/**
 * Reference event adapter (spec §15): reads a normalized event JSON from a
 * file or stdin, evaluates it via `baton detect --event`, and prints the
 * recommendation. Stdin form: `echo '{"harness":"generic",...}' |
 * baton-adapter-generic`
 */
import { readFileSync } from "node:fs";
import { GenericAdapter } from "./index.js";

function main(): void {
  const arg = process.argv[2];
  const raw = arg ? readFileSync(arg, "utf8") : readFileSync(0, "utf8");
  const event = JSON.parse(raw) as { harness: string; signals?: Record<string, unknown> };
  const adapter = new GenericAdapter({ cliCommand: process.env.BATON_BIN ?? "node", cliArgs: process.env.BATON_CLI ? [process.env.BATON_CLI] : [] });
  const result = adapter.detectViaCli(event as never);
  process.stdout.write(
    JSON.stringify(
      {
        pressure: result.pressure,
        readiness: result.readiness,
        recommend: result.recommend,
        recommendedAction: result.recommendedAction,
        reasons: result.reasons,
        suppressed: result.suppress,
      },
      null,
      2,
    ) + "\n",
  );
}

main();
