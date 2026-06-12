import { afterEach, beforeEach, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pickDeletions, runCleanup } from './cleanup.js';
import { getRecording, insertRecording, openDb, updateRecording, upsertStreamer, type Db } from './db.js';

function rec(id: number, size: number, pinned: boolean, started: string, status = 'ready') {
  return { id, size_bytes: size, pinned: pinned ? 1 : 0, started_at: started, status } as any;
}

test('pickDeletions removes oldest non-pinned until under cap', () => {
  const recs = [
    rec(1, 50, false, '2026-01-01'),
    rec(2, 50, true,  '2026-01-02'), // pinned — never deleted
    rec(3, 50, false, '2026-01-03'),
    rec(4, 50, false, '2026-01-04'),
  ];
  expect(pickDeletions(recs, 120)).toEqual([1, 3]); // 200 -> 150 -> 100 <= 120
  expect(pickDeletions(recs, 500)).toEqual([]);
  expect(pickDeletions(recs, 0)).toEqual([1, 3, 4]); // pinned survives even over cap
});

test('pickDeletions ignores non-ready rows', () => {
  const recs = [rec(1, 100, false, '2026-01-01', 'recording'), rec(2, 100, false, '2026-01-02')];
  expect(pickDeletions(recs, 50)).toEqual([2]);
});

let db: Db; let dataDir: string;
beforeEach(() => {
  db = openDb(':memory:');
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dvr-clean-'));
  upsertStreamer(db, { login: 'x', display_name: 'X', avatar_url: '' });
});
afterEach(() => { fs.rmSync(dataDir, { recursive: true, force: true }); });

test('runCleanup deletes files and rows of victims', () => {
  const mk = (dir: string, size: number, started: string) => {
    const id = insertRecording(db, { streamer_login: 'x', started_at: started, title: '', game: '', dir_path: dir });
    const abs = path.join(dataDir, dir);
    fs.mkdirSync(abs, { recursive: true });
    fs.writeFileSync(path.join(abs, 'video.mp4'), 'x'.repeat(size));
    updateRecording(db, id, { status: 'ready', size_bytes: size });
    return id;
  };
  const a = mk('recordings/x/a', 60, '2026-01-01');
  const b = mk('recordings/x/b', 60, '2026-01-02');
  const deleted = runCleanup(db, dataDir, 100 / 1e9); // cap 100 bytes expressed in GB
  expect(deleted).toEqual([a]);
  expect(getRecording(db, a)).toBeUndefined();
  expect(fs.existsSync(path.join(dataDir, 'recordings/x/a'))).toBe(false);
  expect(getRecording(db, b)).toBeDefined();
});
