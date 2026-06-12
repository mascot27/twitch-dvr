import { afterEach, beforeEach, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createBus, type Bus } from './events.js';
import { insertRecording, openDb, updateRecording, upsertStreamer, type Db } from './db.js';
import { buildServer } from './api.js';
import type { FastifyInstance } from 'fastify';
import type { StreamStatus } from './types.js';

let db: Db; let dataDir: string; let app: FastifyInstance; let bus: Bus;
let statuses: StreamStatus[]; let activeLogins: string[];
const recorded: string[] = [];

function status(login: string, live: boolean): StreamStatus {
  return { login, displayName: login.toUpperCase(), avatarUrl: 'av', live,
    title: live ? 'T' : null, game: null, viewers: null, startedAt: null };
}

beforeEach(async () => {
  db = openDb(':memory:');
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dvr-api-'));
  bus = createBus();
  statuses = []; activeLogins = []; recorded.length = 0;
  app = buildServer({
    db, bus, dataDir,
    watcher: {
      getStatuses: () => statuses,
      isStale: () => false,
      isConsideredLive: (l: string) => statuses.some(s => s.login === l && s.live),
      requestTick: () => {},
    },
    recorder: {
      active: () => activeLogins,
      start: (l: string) => { recorded.push(`start:${l}`); },
      stop: async (l: string) => { recorded.push(`stop:${l}`); },
    },
    resolveUser: async (login: string) =>
      login === 'ghost' ? null : { login, displayName: login.toUpperCase(), avatarUrl: 'av' },
    webDistDir: null,
  });
  await app.ready();
});
afterEach(async () => { await app.close().catch(() => {}); fs.rmSync(dataDir, { recursive: true, force: true }); });

test('POST /api/streamers resolves and stores; rejects unknown and garbage', async () => {
  let res = await app.inject({ method: 'POST', url: '/api/streamers', payload: { nameOrUrl: 'https://twitch.tv/Streamerone' } });
  expect(res.statusCode).toBe(201);
  expect(res.json().login).toBe('streamerone');
  res = await app.inject({ method: 'POST', url: '/api/streamers', payload: { nameOrUrl: 'ghost' } });
  expect(res.statusCode).toBe(404);
  res = await app.inject({ method: 'POST', url: '/api/streamers', payload: { nameOrUrl: '!!!' } });
  expect(res.statusCode).toBe(400);
});

test('GET /api/streamers merges db, live status and recording state', async () => {
  upsertStreamer(db, { login: 'a', display_name: 'A', avatar_url: '' });
  statuses = [status('a', true)];
  activeLogins = ['a'];
  const res = await app.inject({ method: 'GET', url: '/api/streamers' });
  const [s] = res.json().streamers;
  expect(s).toMatchObject({ login: 'a', live: true, recording: true, autoRecord: true, title: 'T' });
  expect(res.json().stale).toBe(false);
});

test('PATCH and DELETE /api/streamers/:login', async () => {
  upsertStreamer(db, { login: 'a', display_name: 'A', avatar_url: '' });
  let res = await app.inject({ method: 'PATCH', url: '/api/streamers/a', payload: { autoRecord: false, quality: '720p' } });
  expect(res.statusCode).toBe(200);
  res = await app.inject({ method: 'GET', url: '/api/streamers' });
  expect(res.json().streamers[0]).toMatchObject({ autoRecord: false, quality: '720p' });
  activeLogins = ['a'];
  res = await app.inject({ method: 'DELETE', url: '/api/streamers/a' });
  expect(res.statusCode).toBe(200);
  expect(recorded).toContain('stop:a'); // recording stopped on removal
  res = await app.inject({ method: 'GET', url: '/api/streamers' });
  expect(res.json().streamers).toEqual([]);
});

test('manual record start/stop honors live state', async () => {
  upsertStreamer(db, { login: 'a', display_name: 'A', avatar_url: '' });
  let res = await app.inject({ method: 'POST', url: '/api/streamers/a/record/start' });
  expect(res.statusCode).toBe(409); // not live
  statuses = [status('a', true)];
  res = await app.inject({ method: 'POST', url: '/api/streamers/a/record/start' });
  expect(res.statusCode).toBe(200);
  expect(recorded).toContain('start:a');
  res = await app.inject({ method: 'POST', url: '/api/streamers/a/record/stop' });
  expect(recorded).toContain('stop:a');
});

test('recordings list/patch/delete and chat window', async () => {
  upsertStreamer(db, { login: 'a', display_name: 'A', avatar_url: '' });
  const id = insertRecording(db, { streamer_login: 'a', started_at: '2026-06-12T19:00:00Z', title: 'T', game: 'G', dir_path: 'recordings/a/d' });
  const abs = path.join(dataDir, 'recordings/a/d');
  fs.mkdirSync(abs, { recursive: true });
  fs.writeFileSync(path.join(abs, 'chat.jsonl'), JSON.stringify({ t: 1500, type: 'msg', text: 'yo' }) + '\n');
  updateRecording(db, id, { status: 'ready', size_bytes: 10, duration_s: 60 });

  let res = await app.inject({ method: 'GET', url: '/api/recordings' });
  expect(res.json()[0]).toMatchObject({
    id, streamerLogin: 'a', status: 'ready', pinned: false,
    videoUrl: '/media/recordings/a/d/video.mp4', thumbUrl: '/media/recordings/a/d/thumb.jpg',
  });

  res = await app.inject({ method: 'GET', url: `/api/recordings/${id}/chat?fromMs=0&toMs=5000` });
  expect(res.json()).toHaveLength(1);
  res = await app.inject({ method: 'GET', url: `/api/recordings/${id}/chat?fromMs=2000&toMs=5000` });
  expect(res.json()).toHaveLength(0);

  res = await app.inject({ method: 'PATCH', url: `/api/recordings/${id}`, payload: { pinned: true, resumePositionS: 42.5, chatOffsetMs: -1500 } });
  expect(res.statusCode).toBe(200);
  res = await app.inject({ method: 'GET', url: `/api/recordings/${id}` });
  expect(res.json()).toMatchObject({ pinned: true, resumePositionS: 42.5, chatOffsetMs: -1500 });

  res = await app.inject({ method: 'DELETE', url: `/api/recordings/${id}` });
  expect(res.statusCode).toBe(200);
  expect(fs.existsSync(abs)).toBe(false);
  res = await app.inject({ method: 'GET', url: '/api/recordings' });
  expect(res.json()).toEqual([]);
});

test('DELETE refuses recordings still in progress', async () => {
  upsertStreamer(db, { login: 'a', display_name: 'A', avatar_url: '' });
  const id = insertRecording(db, { streamer_login: 'a', started_at: 'now', title: '', game: '', dir_path: 'recordings/a/x' });
  const res = await app.inject({ method: 'DELETE', url: `/api/recordings/${id}` });
  expect(res.statusCode).toBe(409);
});

test('settings get/patch', async () => {
  let res = await app.inject({ method: 'GET', url: '/api/settings' });
  expect(res.json()).toMatchObject({ diskCapGb: 100, pollIntervalS: 60, dataDir });
  res = await app.inject({ method: 'PATCH', url: '/api/settings', payload: { diskCapGb: 250, pollIntervalS: 45 } });
  expect(res.statusCode).toBe(200);
  res = await app.inject({ method: 'GET', url: '/api/settings' });
  expect(res.json()).toMatchObject({ diskCapGb: 250, pollIntervalS: 45 });
  res = await app.inject({ method: 'PATCH', url: '/api/settings', payload: { diskCapGb: true } });
  expect(res.statusCode).toBe(400);
});

test('media serving with range support', async () => {
  fs.mkdirSync(path.join(dataDir, 'recordings/a/d'), { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'recordings/a/d/video.mp4'), 'ABCDEFGHIJ');
  const res = await app.inject({ method: 'GET', url: '/media/recordings/a/d/video.mp4', headers: { range: 'bytes=2-5' } });
  expect(res.statusCode).toBe(206);
  expect(res.body).toBe('CDEF');
});

test('DELETE refuses recordings whose dir_path escapes the recordings root', async () => {
  upsertStreamer(db, { login: 'a', display_name: 'A', avatar_url: '' });
  const outside = path.join(dataDir, 'outside-marker');
  fs.writeFileSync(outside, 'precious');
  const id = insertRecording(db, { streamer_login: 'a', started_at: 'now', title: '', game: '', dir_path: '..' });
  updateRecording(db, id, { status: 'ready' });
  const res = await app.inject({ method: 'DELETE', url: `/api/recordings/${id}` });
  expect(res.statusCode).toBe(500);
  expect(fs.existsSync(outside)).toBe(true); // nothing outside recordings/ was touched
});

test('PATCH recordings rejects wrong-typed bodies', async () => {
  upsertStreamer(db, { login: 'a', display_name: 'A', avatar_url: '' });
  const id = insertRecording(db, { streamer_login: 'a', started_at: 'now', title: '', game: '', dir_path: 'recordings/a/z' });
  let res = await app.inject({ method: 'PATCH', url: `/api/recordings/${id}`, payload: { resumePositionS: 'not-a-number' } });
  expect(res.statusCode).toBe(400);
  res = await app.inject({ method: 'POST', url: '/api/streamers', payload: { nameOrUrl: 123 } });
  expect(res.statusCode).toBe(400);
});

test('SSE endpoint streams bus events', async () => {
  upsertStreamer(db, { login: 'a', display_name: 'A', avatar_url: '' });
  statuses = [status('a', false)];
  const res = await app.inject({ method: 'GET', url: '/api/events', payloadAsStream: true });
  expect(res.statusCode).toBe(200);
  expect(res.headers['content-type']).toContain('text/event-stream');
  const reader = res.stream();
  const chunks: Buffer[] = [];
  const got = new Promise<string>(resolve => {
    reader.on('data', (c: Buffer) => {
      chunks.push(c);
      const s = Buffer.concat(chunks).toString();
      if (s.includes('event: notify')) resolve(s);
    });
  });
  bus.emit('notify', { title: 'T', body: 'B' });
  const text = await got;
  expect(text).toContain('event: status');  // initial snapshot
  expect(text).toContain('event: notify');
  expect(text).toContain('"title":"T"');
});

test('app.close() resolves while an SSE client is connected', async () => {
  // hijacked SSE replies never end; forceCloseConnections must let close() finish
  const res = await app.inject({ method: 'GET', url: '/api/events', payloadAsStream: true });
  expect(res.statusCode).toBe(200);
  await expect(Promise.race([
    app.close().then(() => 'closed'),
    new Promise(r => setTimeout(() => r('timeout'), 3000)),
  ])).resolves.toBe('closed');
});
