import { expect, test } from 'vitest';
import {
  deleteRecording, deleteStreamer, getRecording, getSetting, getStreamer,
  insertRecording, listByStatus, listRecordings, listStreamers, openDb,
  setSetting, setStreamerFields, totalReadyBytes, touchLastLive,
  updateRecording, updateStreamerMeta, upsertStreamer,
} from './db.js';

function freshDb() { return openDb(':memory:'); }

test('seeds default settings', () => {
  const db = freshDb();
  expect(getSetting(db, 'disk_cap_gb')).toBe('100');
  expect(getSetting(db, 'poll_interval_s')).toBe('60');
  setSetting(db, 'disk_cap_gb', '250');
  expect(getSetting(db, 'disk_cap_gb')).toBe('250');
});

test('streamer CRUD round-trip', () => {
  const db = freshDb();
  upsertStreamer(db, { login: 'streamerone', display_name: 'Streamerone', avatar_url: 'http://a/x.png' });
  expect(listStreamers(db).map(s => s.login)).toEqual(['streamerone']);
  const s = getStreamer(db, 'streamerone')!;
  expect(s.auto_record).toBe(1);
  expect(s.quality).toBe('best');
  setStreamerFields(db, 'streamerone', { auto_record: 0, quality: '720p60,best' });
  expect(getStreamer(db, 'streamerone')!.auto_record).toBe(0);
  updateStreamerMeta(db, 'streamerone', 'STREAMERONE', 'http://a/y.png');
  expect(getStreamer(db, 'streamerone')!.display_name).toBe('STREAMERONE');
  touchLastLive(db, 'streamerone', '2026-06-12T20:00:00Z');
  expect(getStreamer(db, 'streamerone')!.last_live_at).toBe('2026-06-12T20:00:00Z');
  deleteStreamer(db, 'streamerone');
  expect(listStreamers(db)).toEqual([]);
});

test('upsert keeps auto_record/quality on re-add', () => {
  const db = freshDb();
  upsertStreamer(db, { login: 'x', display_name: 'X', avatar_url: '' });
  setStreamerFields(db, 'x', { auto_record: 0 });
  upsertStreamer(db, { login: 'x', display_name: 'X2', avatar_url: 'a' });
  const s = getStreamer(db, 'x')!;
  expect(s.auto_record).toBe(0);
  expect(s.display_name).toBe('X2');
});

test('recording lifecycle', () => {
  const db = freshDb();
  upsertStreamer(db, { login: 'x', display_name: 'X', avatar_url: '' });
  const id = insertRecording(db, {
    streamer_login: 'x', started_at: '2026-06-12T20:00:00Z',
    title: 'T', game: 'G', dir_path: 'recordings/x/2026-06-12_2000_t',
  });
  let r = getRecording(db, id)!;
  expect(r.status).toBe('recording');
  expect(r.pinned).toBe(0);
  updateRecording(db, id, { status: 'ready', size_bytes: 500, duration_s: 12.5, ended_at: '2026-06-12T21:00:00Z' });
  r = getRecording(db, id)!;
  expect(r.status).toBe('ready');
  expect(r.duration_s).toBe(12.5);
  expect(listRecordings(db).length).toBe(1);
  expect(listRecordings(db, 'x').length).toBe(1);
  expect(listRecordings(db, 'other').length).toBe(0);
  expect(listByStatus(db, ['ready']).length).toBe(1);
  expect(totalReadyBytes(db)).toBe(500);
  deleteRecording(db, id);
  expect(listRecordings(db)).toEqual([]);
});

test('recordings survive streamer deletion', () => {
  const db = freshDb();
  upsertStreamer(db, { login: 'x', display_name: 'X', avatar_url: '' });
  const id = insertRecording(db, { streamer_login: 'x', started_at: 'now', title: '', game: '', dir_path: 'p' });
  deleteStreamer(db, 'x');
  expect(getRecording(db, id)).toBeDefined();
});
