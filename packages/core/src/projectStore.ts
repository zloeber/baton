import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import {
  SCHEMA_ID,
  SCHEMA_VERSION,
  Handoff,
  HandoffInputSchema,
  HandoffSchema,
  HandoffStatus,
  checkDraftRequirements,
  defaultAutomation,
  defaultLineage,
  defaultOrigin,
  defaultValidationBlock,
} from "./schema.js";
import { uuidv7, shortId } from "./ids.js";
import { filenameTimestamp } from "./time.js";
import { atomicWriteJsonSync, readJsonSync } from "./fsAtomic.js";
import { resolveBatonDirName } from "./projectInit.js";

const HANDOFFS_DIRNAME = "handoffs";

export interface StoreListing {
  id: string;
  status: HandoffStatus;
  created_at: string;
  updated_at: string;
  title: string;
  objective: string;
  relation: string;
  branch_label: string | null;
  parents: string[];
  file: string;
}

export interface IndexEntry {
  id: string;
  status: string;
  created_at: string;
  updated_at: string;
  title: string;
  file: string;
  score: number | null;
  relation: string;
  parents: string[];
}

export class HandoffNotFoundError extends Error {
  readonly code = "NOT_FOUND";
  constructor(id: string) {
    super(`handoff not found: ${id}`);
    this.name = "HandoffNotFoundError";
  }
}

/**
 * Filesystem-backed store for canonical handoff records.
 *
 * Canonical records are the source of truth (spec §14). Every mutation uses
 * atomic writes. The optional SQLite index can always be rebuilt from these
 * files; `indexEntries()` produces exactly the data it needs.
 */
export class ProjectStore {
  readonly rootDir: string;
  private readonly handoffsDir: string;

  constructor(rootDir: string, batonDirName?: string) {
    this.rootDir = resolve(rootDir);
    this.handoffsDir = join(
      this.rootDir,
      batonDirName ?? resolveBatonDirName(this.rootDir),
      HANDOFFS_DIRNAME,
    );
  }

  get handoffsPath(): string {
    return this.handoffsDir;
  }

  /** Canonical file name: <created-at>--<short-id>.json (spec §7.1). */
  fileNameFor(handoff: Pick<Handoff, "created_at" | "id">): string {
    return `${filenameTimestamp(handoff.created_at)}--${shortId(handoff.id)}.json`;
  }

  pathFor(handoff: Pick<Handoff, "created_at" | "id">): string {
    return join(this.handoffsDir, this.fileNameFor(handoff));
  }

  /** Load every parseable handoff record in the project, oldest first. */
  listAll(): Handoff[] {
    if (!existsSync(this.handoffsDir)) return [];
    const out: Handoff[] = [];
    for (const f of readdirSync(this.handoffsDir).filter((n) => n.endsWith(".json")).sort()) {
      try {
        out.push(this.loadByFile(join(this.handoffsDir, f)));
      } catch {
        // Unparseable files are skipped here; `doctor` reports them.
      }
    }
    return out;
  }

  /** Files in the handoffs dir that fail to parse (for doctor). */
  brokenFiles(): { file: string; error: string }[] {
    if (!existsSync(this.handoffsDir)) return [];
    const out: { file: string; error: string }[] = [];
    for (const f of readdirSync(this.handoffsDir).filter((n) => n.endsWith(".json")).sort()) {
      const p = join(this.handoffsDir, f);
      try {
        HandoffSchema.parse(readJsonSync(p));
      } catch (e) {
        out.push({ file: relative(this.rootDir, p), error: String(e).slice(0, 300) });
      }
    }
    return out;
  }

  loadByFile(filePath: string): Handoff {
    const raw = readJsonSync<Record<string, unknown>>(filePath);
    return HandoffSchema.parse(raw);
  }

  /** Load by exact UUID or unambiguous prefix. */
  load(idOrPrefix: string): Handoff | null {
    const wanted = idOrPrefix.trim().toLowerCase().replace(/-/g, "");
    if (!wanted) return null;
    return this.listAll().find((h) => h.id.replace(/-/g, "").startsWith(wanted)) ?? null;
  }

  loadOrThrow(idOrPrefix: string): Handoff {
    const h = this.load(idOrPrefix);
    if (!h) throw new HandoffNotFoundError(idOrPrefix);
    return h;
  }

  /**
   * Persist a new canonical record. Fills defaults, assigns id/timestamps,
   * refuses duplicate ids/files, and writes atomically.
   */
  create(input: Record<string, unknown>, now: Date = new Date()): Handoff {
    const created = typeof input.created_at === "string" ? input.created_at : now.toISOString();
    const candidate: Record<string, unknown> = {
      $schema: SCHEMA_ID,
      schema_version: SCHEMA_VERSION,
      kind: "handoff",
      status: "draft",
      flags: [],
      created_at: created,
      updated_at: created,
      origin: defaultOrigin(),
      project: { id: "sha256:uninitialized", root_hint: ".", repository: null },
      decisions: [],
      artifacts: [],
      evidence: [],
      failed_attempts: [],
      open_items: [],
      risks: [],
      validation: defaultValidationBlock(),
      lineage: defaultLineage(),
      automation: defaultAutomation(),
      redactions: [],
      ...input,
      id: typeof input.id === "string" ? input.id : uuidv7(new Date(created)),
    };
    // Friendly pre-parse check: report missing draft requirements explicitly
    // instead of leaking raw Zod issues for absent required sections.
    const precheck = HandoffInputSchema.safeParse(candidate);
    if (!precheck.success) {
      const fields = [...new Set(precheck.error.issues.map((i) => i.path.join(".")))].filter(Boolean);
      throw new Error(`draft requirements not met, missing or invalid: ${fields.join(", ")}`);
    }
    const handoff = HandoffSchema.parse(candidate);
    const missing = checkDraftRequirements(handoff);
    if (missing.length > 0) {
      throw new Error(`draft requirements not met, missing: ${missing.join(", ")}`);
    }
    const file = this.pathFor(handoff);
    if (existsSync(file)) {
      throw new Error(`refusing to overwrite existing handoff file: ${file}`);
    }
    mkdirSync(this.handoffsDir, { recursive: true });
    atomicWriteJsonSync(file, handoff);
    return handoff;
  }

  /**
   * Persist an update to an existing record (same file). Ready-record
   * immutability is enforced by the state machine, not here.
   */
  update(handoff: Handoff): Handoff {
    const parsed = HandoffSchema.parse({ ...handoff });
    atomicWriteJsonSync(this.pathFor(parsed), parsed);
    return parsed;
  }

  /** Remove a canonical record file by id (user-directed purge only). */
  delete(idOrPrefix: string): boolean {
    const h = this.load(idOrPrefix);
    if (!h) return false;
    rmSync(this.pathFor(h));
    return true;
  }

  /** Data for the rebuildable index: one entry per canonical record. */
  indexEntries(): IndexEntry[] {
    return this.listAll().map((h) => ({
      id: h.id,
      status: h.status,
      created_at: h.created_at,
      updated_at: h.updated_at,
      title: h.work.title,
      file: this.fileNameFor(h),
      score: h.automation.score,
      relation: h.lineage.relation,
      parents: h.lineage.parents,
    }));
  }

  /** Human-readable one-line summaries for list output. */
  listings(): StoreListing[] {
    return this.listAll().map((h) => ({
      id: h.id,
      status: h.status,
      created_at: h.created_at,
      updated_at: h.updated_at,
      title: h.work.title,
      objective: h.work.objective,
      relation: h.lineage.relation,
      branch_label: h.lineage.branch_label,
      parents: h.lineage.parents,
      file: this.fileNameFor(h),
    }));
  }

  /** Project identity: stable sha256 of the absolute root path (spec §7.2). */
  static projectId(rootDir: string): string {
    const digest = createHash("sha256").update(resolve(rootDir)).digest("hex");
    return `sha256:${digest}`;
  }

  projectInfo(): { id: string; root_hint: string } {
    return { id: ProjectStore.projectId(this.rootDir), root_hint: "." };
  }
}
