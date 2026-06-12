import Database from 'better-sqlite3';
import { nowIso } from './util.js';
import type { RecordingRow, StreamerRow } from './types.js';

export type Db = Database.Database;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS streamers (
  login TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  avatar_url TEXT NOT NULL DEFAULT '',
  auto_record INTEGER NOT NULL DEFAULT 1,
  quality TEXT NOT NULL DEFAULT 'best',
  added_at TEXT NOT NULL,
  last_live_at TEXT
);
CREATE TABLE IF NOT EXISTS recordings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  streamer_login TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  title TEXT NOT NULL DEFAULT '',
  game TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK(status IN ('recording','finalizing','ready','failed')),
  dir_path TEXT NOT NULL,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  duration_s REAL NOT NULL DEFAULT 0,
  pinned INTEGER NOT NULL DEFAULT 0,
  watched_at TEXT,
  resume_position_s REAL NOT NULL DEFAULT 0,
  chat_offset_ms INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
INSERT OR IGNORE INTO settings(key, value) VALUES ('disk_cap_gb', '100'), ('poll_interval_s', '60');
`;

export function openDb(file: string): Db {
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.exec(SCHEMA);
  return db;
}

// settings
export function getSetting(db: Db, key: string): string {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  if (!row) throw new Error(`unknown setting: ${key}`);
  return row.value;
}
export function setSetting(db: Db, key: string, value: string): void {
  db.prepare('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}

// streamers
export function listStreamers(db: Db): StreamerRow[] {
  return db.prepare('SELECT * FROM streamers ORDER BY login').all() as StreamerRow[];
}
export function getStreamer(db: Db, login: string): StreamerRow | undefined {
  return db.prepare('SELECT * FROM streamers WHERE login = ?').get(login) as StreamerRow | undefined;
}
export function upsertStreamer(db: Db, s: { login: string; display_name: string; avatar_url: string }): void {
  db.prepare(`INSERT INTO streamers(login, display_name, avatar_url, added_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(login) DO UPDATE SET display_name = excluded.display_name, avatar_url = excluded.avatar_url`)
    .run(s.login, s.display_name, s.avatar_url, nowIso());
}
export function updateStreamerMeta(db: Db, login: string, displayName: string, avatarUrl: string): void {
  db.prepare('UPDATE streamers SET display_name = ?, avatar_url = ? WHERE login = ?').run(displayName, avatarUrl, login);
}
export function setStreamerFields(db: Db, login: string, f: { auto_record?: number; quality?: string }): void {
  if (f.auto_record !== undefined) db.prepare('UPDATE streamers SET auto_record = ? WHERE login = ?').run(f.auto_record, login);
  if (f.quality !== undefined) db.prepare('UPDATE streamers SET quality = ? WHERE login = ?').run(f.quality, login);
}
export function deleteStreamer(db: Db, login: string): void {
  db.prepare('DELETE FROM streamers WHERE login = ?').run(login);
}
export function touchLastLive(db: Db, login: string, iso: string): void {
  db.prepare('UPDATE streamers SET last_live_at = ? WHERE login = ?').run(iso, login);
}

// recordings
export function insertRecording(db: Db, r: { streamer_login: string; started_at: string; title: string; game: string; dir_path: string }): number {
  const res = db.prepare(`INSERT INTO recordings(streamer_login, started_at, title, game, status, dir_path)
    VALUES (?, ?, ?, ?, 'recording', ?)`).run(r.streamer_login, r.started_at, r.title, r.game, r.dir_path);
  return Number(res.lastInsertRowid);
}
type RecordingPatch = Partial<Pick<RecordingRow,
  'status' | 'ended_at' | 'title' | 'game' | 'size_bytes' | 'duration_s' |
  'pinned' | 'watched_at' | 'resume_position_s' | 'chat_offset_ms'>>;
export function updateRecording(db: Db, id: number, fields: RecordingPatch): void {
  const keys = (Object.keys(fields) as (keyof RecordingPatch)[]).filter(k => fields[k] !== undefined);
  if (!keys.length) return;
  const sets = keys.map(k => `${k} = ?`).join(', ');
  db.prepare(`UPDATE recordings SET ${sets} WHERE id = ?`).run(...keys.map(k => fields[k]), id);
}
export function getRecording(db: Db, id: number): RecordingRow | undefined {
  return db.prepare('SELECT * FROM recordings WHERE id = ?').get(id) as RecordingRow | undefined;
}
export function listRecordings(db: Db, streamer?: string): RecordingRow[] {
  return streamer
    ? db.prepare('SELECT * FROM recordings WHERE streamer_login = ? ORDER BY started_at DESC').all(streamer) as RecordingRow[]
    : db.prepare('SELECT * FROM recordings ORDER BY started_at DESC').all() as RecordingRow[];
}
export function listByStatus(db: Db, statuses: string[]): RecordingRow[] {
  const q = statuses.map(() => '?').join(',');
  return db.prepare(`SELECT * FROM recordings WHERE status IN (${q}) ORDER BY started_at`).all(...statuses) as RecordingRow[];
}
export function deleteRecording(db: Db, id: number): void {
  db.prepare('DELETE FROM recordings WHERE id = ?').run(id);
}
export function totalReadyBytes(db: Db): number {
  const row = db.prepare(`SELECT COALESCE(SUM(size_bytes), 0) AS total FROM recordings WHERE status = 'ready'`).get() as { total: number };
  return row.total;
}
