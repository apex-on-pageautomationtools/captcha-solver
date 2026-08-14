// db.js — Node.js built-in SQLite (no native compilation needed)
const { DatabaseSync } = require('node:sqlite');
const crypto = require('crypto');
const path   = require('path');

// Use /data on Railway (persistent volume) or local dir otherwise
const dbDir = process.env.DATA_DIR || __dirname;
const db    = new DatabaseSync(path.join(dbDir, 'captcha.db'));

db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

// ── Schema ────────────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS api_keys (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    key        TEXT UNIQUE NOT NULL,
    label      TEXT DEFAULT 'default',
    balance    REAL DEFAULT 10.0,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS workers (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    balance       REAL DEFAULT 0.0,
    solved_count  INTEGER DEFAULT 0,
    created_at    TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id         TEXT PRIMARY KEY,
    type       TEXT NOT NULL,
    data       TEXT NOT NULL,
    status     TEXT DEFAULT 'pending',
    solution   TEXT,
    api_key_id INTEGER REFERENCES api_keys(id),
    worker_id  INTEGER REFERENCES workers(id),
    created_at TEXT DEFAULT (datetime('now')),
    solved_at  TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_tasks_status  ON tasks(status);
  CREATE INDEX IF NOT EXISTS idx_tasks_created ON tasks(created_at);
`);

// ── Seed a fixed API key (persists across restarts via env var) ───────────────
const seedKey = process.env.SEED_API_KEY || ('demo_' + crypto.randomBytes(16).toString('hex'));
const exists  = db.prepare('SELECT id FROM api_keys WHERE key = ?').get(seedKey);
if (!exists) {
  db.prepare("INSERT INTO api_keys (key, label, balance) VALUES (?, 'Demo Key', 100.0)").run(seedKey);
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║  🔑  API KEY (save this!)                                    ║');
  console.log(`║  ${seedKey}  ║`);
  console.log('╚══════════════════════════════════════════════════════════════╝\n');
} else {
  console.log(`✅  DB ready  |  API key: ${seedKey}`);
}

module.exports = db;
