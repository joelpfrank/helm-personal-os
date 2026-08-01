import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dbPath as resolveDbPath, ensureStateDir } from './lib/state-paths.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// DASHBOARD_DB_PATH lets a throwaway/test instance point at an isolated DB so
// it never touches the live one. Otherwise the state-dir contract decides:
// $HELM_STATE_DIR/data/dashboard.db when set, server/data/dashboard.db when not.
const DB_PATH = resolveDbPath();
const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

ensureStateDir();
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

try { fs.chmodSync(DB_PATH, 0o600); } catch {}

db.exec(`
  CREATE TABLE IF NOT EXISTS schema_migrations (
    name       TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
`);

// Migrations must run before any other module prepares statements against
// the schema, so we apply them at import time (eagerly) rather than waiting
// for the entry point to call us.
function applyMigrations() {
  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  const applied = new Set(
    db.prepare('SELECT name FROM schema_migrations').all().map((r) => r.name),
  );
  const insert = db.prepare('INSERT INTO schema_migrations (name) VALUES (?)');
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    db.transaction(() => {
      db.exec(sql);
      insert.run(file);
    })();
    console.log(`[db] applied migration ${file}`);
  }
}

applyMigrations();

export function runMigrations() { /* no-op kept for back-compat with index.js */ }

export function dbPath() { return DB_PATH; }
