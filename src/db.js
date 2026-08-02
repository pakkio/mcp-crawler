import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, "..", "data");
fs.mkdirSync(dataDir, { recursive: true });
const dbPath = path.join(dataDir, "crawler.db");

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS pages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url TEXT UNIQUE NOT NULL,
    title TEXT,
    content TEXT,
    fetched_at TEXT NOT NULL
  );

  CREATE VIRTUAL TABLE IF NOT EXISTS pages_fts USING fts5(
    url,
    title,
    content,
    content='pages',
    content_rowid='id'
  );

  CREATE TRIGGER IF NOT EXISTS pages_ai AFTER INSERT ON pages BEGIN
    INSERT INTO pages_fts(rowid, url, title, content) VALUES (new.id, new.url, new.title, new.content);
  END;

  CREATE TRIGGER IF NOT EXISTS pages_ad AFTER DELETE ON pages BEGIN
    INSERT INTO pages_fts(pages_fts, rowid, url, title, content) VALUES ('delete', old.id, old.url, old.title, old.content);
  END;

  CREATE TRIGGER IF NOT EXISTS pages_au AFTER UPDATE ON pages BEGIN
    INSERT INTO pages_fts(pages_fts, rowid, url, title, content) VALUES ('delete', old.id, old.url, old.title, old.content);
    INSERT INTO pages_fts(rowid, url, title, content) VALUES (new.id, new.url, new.title, new.content);
  END;

  CREATE TABLE IF NOT EXISTS usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tool TEXT NOT NULL,
    raw_bytes INTEGER NOT NULL,
    returned_bytes INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );
`);

const upsertStmt = db.prepare(`
  INSERT INTO pages (url, title, content, fetched_at)
  VALUES (@url, @title, @content, @fetched_at)
  ON CONFLICT(url) DO UPDATE SET
    title = excluded.title,
    content = excluded.content,
    fetched_at = excluded.fetched_at
`);

export function savePage({ url, title, content }) {
  upsertStmt.run({ url, title, content, fetched_at: new Date().toISOString() });
}

export function getPageByUrl(url) {
  return db.prepare("SELECT * FROM pages WHERE url = ?").get(url);
}

export function listPages() {
  return db.prepare("SELECT id, url, title, fetched_at, length(content) AS content_length FROM pages ORDER BY fetched_at DESC").all();
}

export function ftsSearch(matchQuery, limit = 20) {
  return db.prepare(`
    SELECT p.url, p.title, p.fetched_at, snippet(pages_fts, 2, '[', ']', ' ... ', 20) AS snippet
    FROM pages_fts
    JOIN pages p ON p.id = pages_fts.rowid
    WHERE pages_fts MATCH ?
    ORDER BY rank
    LIMIT ?
  `).all(matchQuery, limit);
}

export function allPagesForRegex() {
  return db.prepare("SELECT id, url, title, content FROM pages").all();
}

export function clearAll() {
  db.exec("DELETE FROM pages;");
}

const insertUsageStmt = db.prepare(`
  INSERT INTO usage (tool, raw_bytes, returned_bytes, created_at)
  VALUES (?, ?, ?, ?)
`);

export function recordUsage(tool, rawBytes, returnedBytes) {
  insertUsageStmt.run(tool, rawBytes, returnedBytes, new Date().toISOString());
}

export function getTotalContentBytes() {
  return db.prepare("SELECT COALESCE(SUM(length(content)),0) AS total FROM pages").get().total;
}

export function getUsageStats() {
  const byTool = db.prepare(`
    SELECT tool,
           COUNT(*) AS calls,
           COALESCE(SUM(raw_bytes),0) AS raw_bytes,
           COALESCE(SUM(returned_bytes),0) AS returned_bytes
    FROM usage
    GROUP BY tool
    ORDER BY tool
  `).all();
  const totals = db.prepare(`
    SELECT COUNT(*) AS calls,
           COALESCE(SUM(raw_bytes),0) AS raw_bytes,
           COALESCE(SUM(returned_bytes),0) AS returned_bytes
    FROM usage
  `).get();
  return { byTool, totals };
}

export default db;
