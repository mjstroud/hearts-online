import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';

/**
 * SQLite via Node's built-in driver. One file, no native builds.
 * Set DATABASE_PATH to put it on a persistent volume in production.
 */

const MIGRATIONS: string[] = [
  `
  CREATE TABLE users (
    id            INTEGER PRIMARY KEY,
    username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name  TEXT NOT NULL,
    password_hash TEXT,
    is_bot        INTEGER NOT NULL DEFAULT 0,
    created_at    INTEGER NOT NULL
  );
  CREATE TABLE sessions (
    id         TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX sessions_user ON sessions(user_id);
  CREATE TABLE games (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    owner_id    INTEGER NOT NULL REFERENCES users(id),
    join_code   TEXT NOT NULL UNIQUE,
    status      TEXT NOT NULL DEFAULT 'lobby',
    settings    TEXT NOT NULL,
    state       TEXT,
    version     INTEGER NOT NULL DEFAULT 0,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    started_at  INTEGER,
    finished_at INTEGER
  );
  CREATE TABLE game_players (
    game_id   TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    user_id   INTEGER NOT NULL REFERENCES users(id),
    seat      INTEGER NOT NULL,
    joined_at INTEGER NOT NULL,
    PRIMARY KEY (game_id, user_id),
    UNIQUE (game_id, seat)
  );
  CREATE INDEX game_players_user ON game_players(user_id);
  CREATE TABLE hands (
    game_id      TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    number       INTEGER NOT NULL,
    record       TEXT NOT NULL,
    completed_at INTEGER NOT NULL,
    PRIMARY KEY (game_id, number)
  );
  `,
  // v2: solo playtest tables and their dev-tool settings.
  `
  ALTER TABLE games ADD COLUMN mode TEXT NOT NULL DEFAULT 'normal';
  ALTER TABLE games ADD COLUMN dev TEXT;
  `,
  // v3: the computer players are the family cats.
  `
  UPDATE users SET display_name = CASE username
    WHEN 'bot-1' THEN 'Rosie' WHEN 'bot-2' THEN 'Raul' WHEN 'bot-3' THEN 'Pippi'
    WHEN 'bot-4' THEN 'Dash' WHEN 'bot-5' THEN 'Carlito' WHEN 'bot-6' THEN 'Serena'
    WHEN 'bot-7' THEN 'Cali' ELSE display_name END
  WHERE is_bot = 1;
  `,
  // v4: one-time password reset links, made by a site admin.
  `
  CREATE TABLE password_resets (
    id         TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX password_resets_user ON password_resets(user_id);
  `,
  // v5: create the cats up front (same names as CAT_NAMES in games.ts) so nobody can sign up as bot-1…bot-7.
  `
  INSERT OR IGNORE INTO users (username, display_name, password_hash, is_bot, created_at) VALUES
    ('bot-1', 'Rosie', NULL, 1, CAST(strftime('%s', 'now') AS INTEGER) * 1000),
    ('bot-2', 'Raul', NULL, 1, CAST(strftime('%s', 'now') AS INTEGER) * 1000),
    ('bot-3', 'Pippi', NULL, 1, CAST(strftime('%s', 'now') AS INTEGER) * 1000),
    ('bot-4', 'Dash', NULL, 1, CAST(strftime('%s', 'now') AS INTEGER) * 1000),
    ('bot-5', 'Carlito', NULL, 1, CAST(strftime('%s', 'now') AS INTEGER) * 1000),
    ('bot-6', 'Serena', NULL, 1, CAST(strftime('%s', 'now') AS INTEGER) * 1000),
    ('bot-7', 'Cali', NULL, 1, CAST(strftime('%s', 'now') AS INTEGER) * 1000);
  `,
  // v6: profile photos. The image bytes live in their own table so "SELECT * FROM users" stays small.
  `
  CREATE TABLE avatars (
    id         TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type       TEXT NOT NULL,
    data       BLOB NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX avatars_user ON avatars(user_id);
  ALTER TABLE users ADD COLUMN avatar_id TEXT;
  `,
  // v7: which version of the Terms and Privacy Policy each person agreed to, and when. Empty until they do.
  `
  ALTER TABLE users ADD COLUMN terms_version INTEGER;
  ALTER TABLE users ADD COLUMN terms_accepted_at INTEGER;
  `,
];

function migrate(db: DatabaseSync) {
  const { user_version: current } = db.prepare('PRAGMA user_version').get() as { user_version: number };
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
}

function open(): DatabaseSync {
  const file = process.env.DATABASE_PATH || path.resolve('data', 'hearts.db');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;');
  return db;
}

// Keep a single connection across dev-server module reloads, but migrate on every load:
// a reload can bring new migrations, and an up-to-date database is a single PRAGMA read.
const g = globalThis as typeof globalThis & { __heartsDb?: DatabaseSync; __heartsStmts?: Map<string, StatementSync> };
export const db: DatabaseSync = (g.__heartsDb ??= open());
migrate(db);
const statements: Map<string, StatementSync> = (g.__heartsStmts ??= new Map());

/** Cached prepared statement. */
export function sql(text: string): StatementSync {
  let stmt = statements.get(text);
  if (!stmt) {
    stmt = db.prepare(text);
    statements.set(text, stmt);
  }
  return stmt;
}

/** Run `fn` inside a write transaction. */
export function transaction<T>(fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export const now = () => Date.now();
