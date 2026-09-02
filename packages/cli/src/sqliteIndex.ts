/**
 * Rebuildable SQLite index (spec §14). JSON records remain the source of
 * truth; this index accelerates queries and stores ephemeral detector state.
 * It can be deleted at any time and rebuilt with `threadline gc` or on load.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { IndexEntry } from "@threadline/core";

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS handoff_index (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  title TEXT NOT NULL,
  file TEXT NOT NULL,
  score REAL,
  relation TEXT NOT NULL,
  parents TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS detector_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  last_prompt_at TEXT,
  last_pressure REAL,
  session_disabled INTEGER NOT NULL DEFAULT 0,
  session_id TEXT
);
`;

export class SqliteIndex {
  private readonly db: Database.Database;
  readonly path: string;

  constructor(rootDir: string, threadlineDirName = ".threadline") {
    const dir = join(rootDir, threadlineDirName);
    mkdirSync(dir, { recursive: true });
    this.path = join(dir, "index.sqlite");
    this.db = new Database(this.path);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(SCHEMA_SQL);
  }

  /** Replace all rows from canonical records (rebuild). */
  rebuild(entries: IndexEntry[]): void {
    const tx = this.db.transaction((rows: IndexEntry[]) => {
      this.db.prepare("DELETE FROM handoff_index").run();
      const insert = this.db.prepare(
        `INSERT INTO handoff_index (id, status, created_at, updated_at, title, file, score, relation, parents)
         VALUES (@id, @status, @created_at, @updated_at, @title, @file, @score, @relation, @parents)`,
      );
      for (const r of rows) {
        insert.run({ ...r, parents: JSON.stringify(r.parents) });
      }
    });
    tx(entries);
  }

  query(opts: { status?: string; work?: string } = {}): IndexEntry[] {
    let sql = "SELECT * FROM handoff_index";
    const clauses: string[] = [];
    const params: Record<string, unknown> = {};
    if (opts.status) {
      clauses.push("status = @status");
      params.status = opts.status;
    }
    if (opts.work) {
      clauses.push("(title LIKE @work OR file LIKE @work)");
      params.work = `%${opts.work}%`;
    }
    if (clauses.length > 0) sql += " WHERE " + clauses.join(" AND ");
    sql += " ORDER BY created_at ASC";
    const rows = this.db.prepare(sql).all(params) as (IndexEntry & { parents: string })[];
    return rows.map((r) => ({ ...r, parents: JSON.parse(r.parents) as string[] }));
  }

  counts(): Record<string, number> {
    const rows = this.db
      .prepare("SELECT status, COUNT(*) as n FROM handoff_index GROUP BY status")
      .all() as { status: string; n: number }[];
    const out: Record<string, number> = {};
    for (const r of rows) out[r.status] = r.n;
    return out;
  }

  getDetectorState(): {
    last_prompt_at: string | null;
    last_pressure: number | null;
    session_disabled: boolean;
  } {
    const row = this.db
      .prepare("SELECT last_prompt_at, last_pressure, session_disabled FROM detector_state WHERE id = 1")
      .get() as { last_prompt_at: string | null; last_pressure: number | null; session_disabled: number } | undefined;
    if (!row) return { last_prompt_at: null, last_pressure: null, session_disabled: false };
    return {
      last_prompt_at: row.last_prompt_at,
      last_pressure: row.last_pressure,
      session_disabled: row.session_disabled === 1,
    };
  }

  setDetectorState(s: {
    last_prompt_at?: string | null;
    last_pressure?: number | null;
    session_disabled?: boolean;
    session_id?: string | null;
  }): void {
    this.db
      .prepare(
        `INSERT INTO detector_state (id, last_prompt_at, last_pressure, session_disabled, session_id)
         VALUES (1, @last_prompt_at, @last_pressure, @session_disabled, @session_id)
         ON CONFLICT(id) DO UPDATE SET
           last_prompt_at = COALESCE(@last_prompt_at, last_prompt_at),
           last_pressure = COALESCE(@last_pressure, last_pressure),
           session_disabled = COALESCE(@session_disabled, session_disabled),
           session_id = COALESCE(@session_id, session_id)`,
      )
      .run({
        last_prompt_at: s.last_prompt_at ?? null,
        last_pressure: s.last_pressure ?? null,
        // Concrete on fresh insert (NOT NULL column); COALESCE preserves the
        // stored value on updates that omit it.
        session_disabled: s.session_disabled === undefined ? (this.getDetectorState().session_disabled ? 1 : 0) : s.session_disabled ? 1 : 0,
        session_id: s.session_id ?? null,
      });
  }

  recordMetric(name: string, value: number): void {
    this.db
      .prepare(
        `CREATE TABLE IF NOT EXISTS metrics (
           name TEXT NOT NULL,
           at TEXT NOT NULL,
           value REAL NOT NULL
         )`,
      )
      .run();
    this.db
      .prepare("INSERT INTO metrics (name, at, value) VALUES (?, ?, ?)")
      .run(name, new Date().toISOString(), value);
  }

  metrics(): { name: string; at: string; value: number }[] {
    try {
      return this.db
        .prepare("SELECT name, at, value FROM metrics ORDER BY at ASC")
        .all() as { name: string; at: string; value: number }[];
    } catch {
      return [];
    }
  }

  close(): void {
    this.db.close();
  }
}
