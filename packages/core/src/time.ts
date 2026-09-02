export function nowIso(now: Date = new Date()): string {
  return now.toISOString();
}

/**
 * File-name timestamp per spec 7.1: UTC RFC 3339 with punctuation removed.
 * e.g. 2026-09-02T14:30:00Z -> 20260902T143000Z
 */
export function filenameTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw new Error(`invalid ISO timestamp: ${iso}`);
  return (
    `${d.getUTCFullYear()}` +
    `${String(d.getUTCMonth() + 1).padStart(2, "0")}` +
    `${String(d.getUTCDate()).padStart(2, "0")}` +
    `T` +
    `${String(d.getUTCHours()).padStart(2, "0")}` +
    `${String(d.getUTCMinutes()).padStart(2, "0")}` +      `${String(d.getUTCSeconds()).padStart(2, "0")}` +
    `Z`
  );
}

export function parseFilenameTimestamp(ts: string): Date | null {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(ts);
  if (!m) return null;
  const d = new Date(
    Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +m[6]!),
  );
  return Number.isNaN(d.getTime()) ? null : d;
}
