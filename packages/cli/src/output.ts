import { EXIT_OK } from "./exitCodes.js";

export interface OutputOptions {
  json?: boolean | undefined;
}

/** Emit either stable JSON or human text; returns process exit code. */
export function emit(out: { json?: boolean }, payload: unknown, text?: string): number {
  if (out.json) {
    process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
  } else if (text !== undefined) {
    process.stdout.write(text);
  }
  return EXIT_OK;
}
