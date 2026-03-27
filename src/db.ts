import { Database } from "bun:sqlite";
import { resolve, dirname } from "path";
import { existsSync, mkdirSync, readFileSync, statSync } from "fs";
import type {
  Card,
  Column,
  CardType,
  Priority,
  DecisionLogEntry,
  ContextSnapshot,
  CardFile,
} from "./models/card";

const SCHEMA_VERSION = 1;

/**
 * Find the git root directory, resolving through worktree .git files.
 *
 *   .git directory (normal repo) → return that dir
 *   .git file (worktree) → parse "gitdir: ..." → resolve to main repo root
 *
 * This ensures all worktrees share one .kanban/board.db.
 */
function findGitRoot(from: string): string | null {
  let dir = resolve(from);
  while (dir !== "/") {
    const gitPath = resolve(dir, ".git");
    if (existsSync(gitPath)) {
      try {
        const stat = statSync(gitPath);
        if (stat.isFile()) {
          // Worktree: .git is a file containing "gitdir: /path/to/.git/worktrees/<name>"
          const content = readFileSync(gitPath, "utf-8").trim();
          const match = content.match(/^gitdir:\s+(.+)/);
          if (match) {
            const gitDir = resolve(dir, match[1]);
            // .git/worktrees/<name> → go up 3 levels to main repo root
            const mainRoot = resolve(gitDir, "../../..");
            if (existsSync(resolve(mainRoot, ".git"))) return mainRoot;
          }
        }
      } catch {
        // Fall through to treat as normal git dir
      }
      return dir;
    }
    dir = dirname(dir);
  }
  return null;
}

function getDbPath(): string {
  const gitRoot = findGitRoot(process.cwd());
  const root = gitRoot ?? process.cwd();
  const kanbanDir = resolve(root, ".kanban");
  if (!existsSync(kanbanDir)) mkdirSync(kanbanDir, { recursive: true });
  return resolve(kanbanDir, "board.db");
}

let _db: Database | null = null;

export function getDb(): Database {
  if (_db) return _db;
  const dbPath = getDbPath();
  const isNew = !existsSync(dbPath);
  _db = new Database(dbPath);
  _db.exec("PRAGMA journal_mode=WAL");
  _db.exec("PRAGMA busy_timeout=5000");
  _db.exec("PRAGMA foreign_keys=ON");
  if (isNew) createSchema(_db);
  else migrateIfNeeded(_db);
  return _db;
}

export function closeDb() {
  if (_db) {
    _db.close();
    _db = null;
  }
}

function createSchema(db: Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS cards (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      short_id    TEXT UNIQUE NOT NULL,
      title       TEXT NOT NULL,
      description TEXT,
      "column"    TEXT NOT NULL DEFAULT 'backlog',
      priority    INTEGER DEFAULT 3,
      type        TEXT DEFAULT 'feature',
      created_at  TEXT NOT NULL,
      updated_at  TEXT NOT NULL,
      completed_at TEXT,
      archived    INTEGER DEFAULT 0,
      sort_order  INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS decision_log (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      card_id     INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
      decision    TEXT NOT NULL,
      reasoning   TEXT,
      created_at  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS context_snapshots (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      card_id     INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
      branch      TEXT,
      commit_hash TEXT,
      notes       TEXT,
      created_at  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS card_files (
      card_id     INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
      file_path   TEXT NOT NULL,
      PRIMARY KEY (card_id, file_path)
    );
    CREATE INDEX IF NOT EXISTS idx_card_files_path ON card_files(file_path);

    CREATE TABLE IF NOT EXISTS project_meta (
      key   TEXT PRIMARY KEY,
      value TEXT
    );
  `);
  setMeta(db, "schema_version", String(SCHEMA_VERSION));
  setMeta(db, "prefix", "KB");
}

function migrateIfNeeded(db: Database) {
  const ver = Number(getMeta(db, "schema_version") ?? "0");
  if (ver >= SCHEMA_VERSION) return;
  // Future migrations go here as sequential if blocks
  setMeta(db, "schema_version", String(SCHEMA_VERSION));
}

// --- Meta helpers ---

export function getMeta(db: Database, key: string): string | null {
  const row = db
    .query("SELECT value FROM project_meta WHERE key = ?")
    .get(key) as { value: string } | null;
  return row?.value ?? null;
}

export function setMeta(db: Database, key: string, value: string) {
  db.query(
    "INSERT OR REPLACE INTO project_meta (key, value) VALUES (?, ?)",
  ).run(key, value);
}

function touchLastActive(db: Database) {
  setMeta(db, "last_active", new Date().toISOString());
}

function getPrefix(db: Database): string {
  return getMeta(db, "prefix") ?? "KB";
}

// --- Card CRUD ---

export function createCard(
  title: string,
  opts: {
    type?: CardType;
    priority?: Priority;
    column?: Column;
    description?: string;
  } = {},
): Card {
  const db = getDb();
  touchLastActive(db);
  const now = new Date().toISOString();
  const type = opts.type ?? "feature";
  const priority = opts.priority ?? 3;
  const col = opts.column ?? "backlog";
  const desc = opts.description ?? null;

  // Get next sort order for the target column
  const maxSort = db
    .query(
      'SELECT COALESCE(MAX(sort_order), 0) as m FROM cards WHERE "column" = ? AND archived = 0',
    )
    .get(col) as { m: number };
  const sortOrder = maxSort.m + 1;

  const result = db
    .query(
      `INSERT INTO cards (short_id, title, description, "column", priority, type, created_at, updated_at, sort_order)
       VALUES ('_tmp', ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(title, desc, col, priority, type, now, now, sortOrder);

  const id = Number(result.lastInsertRowid);
  const prefix = getPrefix(db);
  const shortId = `${prefix}-${id}`;
  db.query("UPDATE cards SET short_id = ? WHERE id = ?").run(shortId, id);

  return getCardById(id)!;
}

export function getCardById(id: number): Card | null {
  const db = getDb();
  return db.query("SELECT * FROM cards WHERE id = ?").get(id) as Card | null;
}

export function getCardByShortId(shortId: string): Card | null {
  const db = getDb();
  return db
    .query("SELECT * FROM cards WHERE short_id = ? COLLATE NOCASE")
    .get(shortId) as Card | null;
}

export function resolveCard(idOrShortId: string): Card | null {
  // Try short_id first (e.g. "KB-7"), then numeric id
  let card = getCardByShortId(idOrShortId);
  if (!card) {
    const numId = parseInt(idOrShortId, 10);
    if (!isNaN(numId)) card = getCardById(numId);
  }
  return card;
}

export function listCards(
  opts: {
    column?: Column;
    type?: CardType;
    archived?: boolean;
  } = {},
): Card[] {
  const db = getDb();
  touchLastActive(db);
  let sql = "SELECT * FROM cards WHERE 1=1";
  const params: any[] = [];

  if (opts.archived !== undefined) {
    sql += " AND archived = ?";
    params.push(opts.archived ? 1 : 0);
  } else {
    sql += " AND archived = 0";
  }

  if (opts.column) {
    sql += ' AND "column" = ?';
    params.push(opts.column);
  }
  if (opts.type) {
    sql += " AND type = ?";
    params.push(opts.type);
  }

  sql += " ORDER BY priority ASC, sort_order ASC";
  return db.query(sql).all(...params) as Card[];
}

export function updateCard(
  id: number,
  updates: Partial<
    Pick<
      Card,
      | "title"
      | "description"
      | "type"
      | "priority"
      | "column"
      | "sort_order"
      | "completed_at"
      | "archived"
    >
  >,
) {
  const db = getDb();
  touchLastActive(db);
  const sets: string[] = [];
  const params: any[] = [];

  for (const [key, value] of Object.entries(updates)) {
    if (key === "column") {
      sets.push('"column" = ?');
    } else {
      sets.push(`${key} = ?`);
    }
    params.push(value);
  }

  sets.push("updated_at = ?");
  params.push(new Date().toISOString());
  params.push(id);

  db.query(`UPDATE cards SET ${sets.join(", ")} WHERE id = ?`).run(...params);
}

export function moveCard(id: number, column: Column) {
  const db = getDb();
  const maxSort = db
    .query(
      'SELECT COALESCE(MAX(sort_order), 0) as m FROM cards WHERE "column" = ? AND archived = 0',
    )
    .get(column) as { m: number };

  const updates: any = { column, sort_order: maxSort.m + 1 };
  if (column === "done") {
    updates.completed_at = new Date().toISOString();
  }
  updateCard(id, updates);
}

export function deleteCard(id: number) {
  const db = getDb();
  touchLastActive(db);
  db.query("DELETE FROM cards WHERE id = ?").run(id);
}

export function autoArchive() {
  const db = getDb();
  const thirtyDaysAgo = new Date(
    Date.now() - 30 * 24 * 60 * 60 * 1000,
  ).toISOString();
  db.query(
    `UPDATE cards SET archived = 1 WHERE "column" = 'done' AND completed_at IS NOT NULL AND completed_at < ? AND archived = 0`,
  ).run(thirtyDaysAgo);
}

// --- Decision Log ---

export function addDecision(
  cardId: number,
  decision: string,
  reasoning?: string,
): DecisionLogEntry {
  const db = getDb();
  touchLastActive(db);
  const now = new Date().toISOString();
  const result = db
    .query(
      "INSERT INTO decision_log (card_id, decision, reasoning, created_at) VALUES (?, ?, ?, ?)",
    )
    .run(cardId, decision, reasoning ?? null, now);
  return {
    id: Number(result.lastInsertRowid),
    card_id: cardId,
    decision,
    reasoning: reasoning ?? null,
    created_at: now,
  };
}

export function getDecisions(cardId: number): DecisionLogEntry[] {
  const db = getDb();
  return db
    .query(
      "SELECT * FROM decision_log WHERE card_id = ? ORDER BY created_at DESC",
    )
    .all(cardId) as DecisionLogEntry[];
}

// --- Context Snapshots ---

export function addSnapshot(
  cardId: number,
  opts: { branch?: string; commitHash?: string; notes?: string } = {},
): ContextSnapshot {
  const db = getDb();
  touchLastActive(db);
  const now = new Date().toISOString();
  const result = db
    .query(
      "INSERT INTO context_snapshots (card_id, branch, commit_hash, notes, created_at) VALUES (?, ?, ?, ?, ?)",
    )
    .run(
      cardId,
      opts.branch ?? null,
      opts.commitHash ?? null,
      opts.notes ?? null,
      now,
    );
  return {
    id: Number(result.lastInsertRowid),
    card_id: cardId,
    branch: opts.branch ?? null,
    commit_hash: opts.commitHash ?? null,
    notes: opts.notes ?? null,
    created_at: now,
  };
}

export function getSnapshots(cardId: number): ContextSnapshot[] {
  const db = getDb();
  return db
    .query(
      "SELECT * FROM context_snapshots WHERE card_id = ? ORDER BY created_at DESC",
    )
    .all(cardId) as ContextSnapshot[];
}

// --- Card Files ---

export function addCardFile(cardId: number, filePath: string) {
  const db = getDb();
  db.query(
    "INSERT OR IGNORE INTO card_files (card_id, file_path) VALUES (?, ?)",
  ).run(cardId, filePath);
}

export function getCardFiles(cardId: number): string[] {
  const db = getDb();
  const rows = db
    .query("SELECT file_path FROM card_files WHERE card_id = ?")
    .all(cardId) as {
    file_path: string;
  }[];
  return rows.map((r) => r.file_path);
}

export function getCardsByFile(filePath: string): Card[] {
  const db = getDb();
  return db
    .query(
      "SELECT c.* FROM cards c JOIN card_files cf ON c.id = cf.card_id WHERE cf.file_path = ? AND c.archived = 0",
    )
    .all(filePath) as Card[];
}
