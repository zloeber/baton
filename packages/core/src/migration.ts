/**
 * Legacy storage migration (spec-hermes-adapter §7.2-7.3).
 *
 * Moves `.threadline/` to `.baton/` and rewrites each canonical handoff's
 * `$schema` id from the legacy threadline.dev URL to the baton.dev URL.
 * Never runs without explicit consent: callers pass `dryRun` first and act
 * on the returned plan. Records are otherwise untouched (unknown fields are
 * preserved by the passthrough schema).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { LEGACY_BATON_DIR, BATON_DIR } from "./projectInit.js";

export const LEGACY_SCHEMA_ID = "https://threadline.dev/schemas/handoff/v0.1.json";
export const CURRENT_SCHEMA_ID = "https://baton.dev/schemas/handoff/v0.1.json";

export interface MigrationPlanItem {
  source: string;
  destination: string;
  action: "move-dir" | "rewrite-schema" | "copy";
}

export interface MigrationPlan {
  legacy_dir: string;
  target_dir: string;
  items: MigrationPlanItem[];
  handoffs_to_rewrite: string[];
  would_remove_legacy: boolean;
  warnings: string[];
}

export function detectLegacyProject(rootDir: string): boolean {
  return existsSync(join(rootDir, LEGACY_BATON_DIR));
}

/** Build the full migration plan without touching the filesystem. */
export function planLegacyMigration(rootDir: string): MigrationPlan {
  const legacyDir = join(rootDir, LEGACY_BATON_DIR);
  const targetDir = join(rootDir, BATON_DIR);
  const items: MigrationPlanItem[] = [];
  const handoffs: string[] = [];
  const warnings: string[] = [];

  if (existsSync(targetDir)) {
    warnings.push(
      `${BATON_DIR}/ already exists; legacy records will be merged and ${LEGACY_BATON_DIR}/ will be renamed to ${BATON_DIR}.legacy/ instead of removed`,
    );
  }
  if (!existsSync(legacyDir)) {
    warnings.push(`${LEGACY_BATON_DIR}/ does not exist; nothing to migrate`);
  }

  // Canonical handoffs whose $schema needs rewriting.
  const legacyHandoffs = join(legacyDir, "handoffs");
  if (existsSync(legacyHandoffs)) {
    for (const f of readdirSync(legacyHandoffs).filter((n) => n.endsWith(".json")).sort()) {
      const p = join(legacyHandoffs, f);
      try {
        const raw = JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>;
        if (raw["$schema"] === LEGACY_SCHEMA_ID) {
          handoffs.push(f);
        } else if (raw["$schema"] !== CURRENT_SCHEMA_ID) {
          warnings.push(`handoffs/${f}: unknown $schema ${String(raw["$schema"])}; will be preserved as-is`);
        }
      } catch {
        warnings.push(`handoffs/${f}: unparseable; migrated verbatim, review manually`);
      }
    }
  }

  if (existsSync(legacyDir) && !existsSync(targetDir)) {
    items.push({ source: LEGACY_BATON_DIR, destination: BATON_DIR, action: "move-dir" });
  } else if (existsSync(legacyDir)) {
    items.push({
      source: LEGACY_BATON_DIR,
      destination: `${BATON_DIR}.legacy`,
      action: "move-dir",
    });
  }

  return {
    legacy_dir: legacyDir,
    target_dir: targetDir,
    items,
    handoffs_to_rewrite: handoffs,
    would_remove_legacy: existsSync(legacyDir) && !existsSync(targetDir),
    warnings,
  };
}

export interface MigrationResult {
  migrated: boolean;
  plan: MigrationPlan;
  rewritten: string[];
  backup_dir: string | null;
}

/**
 * Execute the migration with consent already granted by the caller.
 * Idempotent: re-running with no legacy dir is a no-op.
 */
export function migrateLegacyProject(rootDir: string): MigrationResult {
  const plan = planLegacyMigration(rootDir);
  const rewritten: string[] = [];
  if (!existsSync(join(rootDir, LEGACY_BATON_DIR))) {
    return { migrated: false, plan, rewritten, backup_dir: null };
  }

  const targetExists = existsSync(join(rootDir, BATON_DIR));
  let backupDir: string | null = null;

  if (targetExists) {
    // Merge mode: move legacy aside, then copy missing files into target.
    backupDir = join(rootDir, `${BATON_DIR}.legacy`);
    rmSync(backupDir, { recursive: true, force: true });
    renameSync(join(rootDir, LEGACY_BATON_DIR), backupDir);
    mergeDirs(backupDir, join(rootDir, BATON_DIR));
    plan.would_remove_legacy = false;
  } else {
    renameSync(join(rootDir, LEGACY_BATON_DIR), join(rootDir, BATON_DIR));
  }

  // Rewrite $schema ids on canonical handoffs now living under .baton/.
  const handoffsDir = join(rootDir, BATON_DIR, "handoffs");
  if (existsSync(handoffsDir)) {
    for (const f of readdirSync(handoffsDir).filter((n) => n.endsWith(".json"))) {
      const p = join(handoffsDir, f);
      try {
        const raw = JSON.parse(readFileSync(p, "utf8")) as Record<string, unknown>;
        if (raw["$schema"] === LEGACY_SCHEMA_ID) {
          raw["$schema"] = CURRENT_SCHEMA_ID;
          writeFileSync(p, JSON.stringify(raw, null, 2) + "\n");
          rewritten.push(f);
        }
      } catch {
        // Unparseable files were warned about in the plan; leave verbatim.
      }
    }
  }

  return { migrated: true, plan, rewritten, backup_dir: backupDir };
}

/** Copy files/dirs from src into dst without overwriting existing files. */
function mergeDirs(src: string, dst: string): void {
  mkdirSync(dst, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const s = join(src, entry.name);
    const d = join(dst, entry.name);
    if (entry.isDirectory()) {
      mergeDirs(s, d);
    } else if (!existsSync(d)) {
      const content = readFileSync(s);
      writeFileSync(d, content);
    }
  }
}
