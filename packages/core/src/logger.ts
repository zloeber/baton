/**
 * Local structured logging (spec §17). Disabled by default; enable with
 * THREADLINE_LOG=info|debug. Logs contain record ids and event names only —
 * never handoff body values, command output, or secrets. Output is JSONL
 * appended to a caller-provided sink (the CLI uses .threadline/cache/log.jsonl).
 */
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type LogLevel = "info" | "debug";

const LEVELS: Record<LogLevel, number> = { info: 1, debug: 2 };

let sinkPath: string | null = null;
let level: number = 0;

function envLevel(): number {
  const raw = process.env.THREADLINE_LOG;
  if (raw === "info") return LEVELS.info;
  if (raw === "debug") return LEVELS.debug;
  return 0;
}

/**
 * Configure logging once per process. Disabled by default (§17): enabled only
 * when THREADLINE_LOG is set or the project config supplies a level.
 * Pass null to disable entirely.
 */
export function configureLogger(sink: string | null, configuredLevel: LogLevel | null = null): void {
  const env = envLevel();
  if (env !== 0) {
    level = env;
    sinkPath = sink;
    return;
  }
  level = configuredLevel === null ? 0 : LEVELS[configuredLevel];
  sinkPath = level === 0 ? null : sink;
}

export interface LogFields {
  /** Record/handoff id when one exists. Never embed body values. */
  id?: string;
  [key: string]: string | number | undefined;
}

export function logEvent(event: string, fields: LogFields = {}): void {
  if (level === 0 || sinkPath === null) return;
  const entry = {
    at: new Date().toISOString(),
    event,
    ...fields,
  };
  try {
    if (!existsSync(dirname(sinkPath))) mkdirSync(dirname(sinkPath), { recursive: true });
    appendFileSync(sinkPath, JSON.stringify(entry) + "\n");
  } catch {
    // Logging must never break the command.
  }
}
