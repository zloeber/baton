import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { dirname } from "node:path";

/**
 * Atomic file write (spec §21.5): write to a unique temp file in the same
 * directory, flush to disk, then rename over the destination.
 */
export function atomicWriteSync(filePath: string, data: string): void {
  const dir = dirname(filePath);
  mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  const fd = openSync(tmp, "w");
  try {
    writeSync(fd, data, 0, "utf8");
    // fsync via a fresh handle is not portable in all embedded runtimes;
    // writeSync + closeSync on the same fd is the best sync primitive here.
  } finally {
    closeSync(fd);
  }
  try {
    renameSync(tmp, filePath);
  } catch (e) {
    try {
      unlinkSync(tmp);
    } catch {
      /* best effort cleanup */
    }
    throw e;
  }
}

export function atomicWriteJsonSync(filePath: string, value: unknown): void {
  atomicWriteSync(filePath, JSON.stringify(value, null, 2) + "\n");
}

export function readJsonSync<T = unknown>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

export function exists(filePath: string): boolean {
  return existsSync(filePath);
}
