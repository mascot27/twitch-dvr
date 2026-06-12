import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createBus } from './events.js';
import { getRecording, listRecordings, openDb, upsertStreamer, setStreamerFields, type Db } from './db.js';
import { createRecorder, type ChildLike } from './recorder.js';
import type { StreamStatus } from './types.js';

class FakeChild extends EventEmitter implements ChildLike {
  pid = 4242;
  exitCode: number | null = null;
  killed: string[] = [];
  kill(sig?: NodeJS.Signals | number) { this.killed.push(String(sig)); this.exit(0); return true; }
  exit(code: number) { if (this.exitCode === null) { this.exitCode = code; this.emit('exit', code); } }
}

let db: Db; let dataDir: string;
let spawned: { cmd: string; args: string[]; child: FakeChild }[];
let live: boolean;
let finalized: number[];
let chatCalls: string[];

beforeEach(() => {
  db = openDb(':memory:');
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dvr-rec-'));
  upsertStreamer(db, { login: 'streamerone', display_name: 'Streamerone', avatar_url: '' });
  spawned = []; live = true; finalized = []; chatCalls = [];
});
afterEach(() => { fs.rmSync(dataDir, { recursive: true, force: true }); vi.useRealTimers(); });

function make(extra: { freeBytes?: number } = {}) {
  const bus = createBus();
  return { bus, recorder: createRecorder({
    db, dataDir, bus,
    spawnFn: ((cmd: string, args: string[]) => { const child = new FakeChild(); spawned.push({ cmd, args, child }); return child; }) as any,
    finalizeFn: async (_db, recId) => { finalized.push(recId); },
    chat: { join: (l) => chatCalls.push(`join:${l}`), part: (l) => chatCalls.push(`part:${l}`) },
    isLive: () => live,
    getFreeBytes: () => extra.freeBytes ?? 100e9,
    restartDelayMs: 5,
    killTimeoutMs: 10,
  }) };
}

const STATUS: StreamStatus = { login: 'streamerone', displayName: 'Streamerone', avatarUrl: '', live: true,
  title: 'Cool Stream', game: 'IRL', viewers: 5, startedAt: '2026-06-12T19:00:00Z' };

test('start spawns streamlink + caffeinate, creates dir and row, joins chat', () => {
  const { recorder } = make();
  recorder.start('streamerone', STATUS);
  expect(recorder.active()).toEqual(['streamerone']);
  expect(spawned[0].cmd).toBe('streamlink');
  expect(spawned[0].args).toContain('--twitch-disable-ads');
  expect(spawned[0].args).toContain('twitch.tv/streamerone');
  expect(spawned[0].args).toContain('best');
  expect(spawned[0].args.join(' ')).toMatch(/part-001\.ts/);
  expect(spawned[1].cmd).toBe('caffeinate');
  expect(spawned[1].args).toEqual(['-i', '-w', String(process.pid)]);
  const rec = listRecordings(db)[0];
  expect(rec.status).toBe('recording');
  expect(rec.title).toBe('Cool Stream');
  expect(fs.existsSync(path.join(dataDir, rec.dir_path))).toBe(true);
  expect(chatCalls).toContain('join:streamerone');
  recorder.start('streamerone', STATUS); // idempotent
  expect(listRecordings(db)).toHaveLength(1);
});

test('uses streamer quality setting', () => {
  setStreamerFields(db, 'streamerone', { quality: '720p60,best' });
  const { recorder } = make();
  recorder.start('streamerone', STATUS);
  expect(spawned[0].args).toContain('720p60,best');
});

test('restarts with next part when child exits while still live', async () => {
  const { recorder } = make();
  recorder.start('streamerone', STATUS);
  spawned[0].child.exit(1);
  await new Promise(r => setTimeout(r, 30));
  expect(recorder.active()).toEqual(['streamerone']);
  const slArgs = spawned.filter(s => s.cmd === 'streamlink');
  expect(slArgs).toHaveLength(2);
  expect(slArgs[1].args.join(' ')).toMatch(/part-002\.ts/);
  expect(spawned.filter(s => s.cmd === 'caffeinate')).toHaveLength(1);
});

test('finalizes when child exits and stream is no longer live', async () => {
  const { recorder } = make();
  recorder.start('streamerone', STATUS);
  live = false;
  spawned[0].child.exit(0);
  await vi.waitFor(() => expect(finalized).toHaveLength(1));
  expect(recorder.active()).toEqual([]);
  expect(chatCalls).toContain('part:streamerone');
});

test('stop kills child, marks finalizing then calls finalize', async () => {
  const { recorder } = make();
  recorder.start('streamerone', STATUS);
  const recId = listRecordings(db)[0].id;
  await recorder.stop('streamerone');
  expect(spawned[0].child.killed.length).toBeGreaterThan(0);
  expect(spawned[1].child.killed.length).toBeGreaterThan(0);
  expect(finalized).toEqual([recId]);
  const rec = getRecording(db, recId)!;
  expect(rec.ended_at).not.toBeNull();
});

test('marks failed when finalize throws', async () => {
  const bus = createBus();
  const recorder = createRecorder({
    db, dataDir, bus,
    spawnFn: ((_c: string, _a: string[]) => { const ch = new FakeChild(); spawned.push({ cmd: _c, args: _a, child: ch }); return ch; }) as any,
    finalizeFn: async () => { throw new Error('boom'); },
    chat: { join: () => {}, part: () => {} },
    isLive: () => true, getFreeBytes: () => 100e9, restartDelayMs: 5,
  });
  recorder.start('streamerone', STATUS);
  await recorder.stop('streamerone');
  expect(listRecordings(db)[0].status).toBe('failed');
});

test('refuses to start when free disk below 10GB and notifies', () => {
  const { recorder, bus } = make({ freeBytes: 5e9 });
  const notices: string[] = [];
  bus.on('notify', n => notices.push(n.title));
  recorder.start('streamerone', STATUS);
  expect(recorder.active()).toEqual([]);
  expect(listRecordings(db)).toHaveLength(0);
  expect(notices.length).toBe(1);
});

test('spawn error marks recording failed without crashing or hanging', async () => {
  const bus = createBus();
  const notices: string[] = [];
  bus.on('notify', n => notices.push(n.title));
  const recorder = createRecorder({
    db, dataDir, bus,
    spawnFn: ((cmd: string, args: string[]) => { const child = new FakeChild(); spawned.push({ cmd, args, child }); return child; }) as any,
    finalizeFn: async () => { throw new Error('no part files to finalize'); },
    chat: { join: () => {}, part: () => {} },
    isLive: () => true, getFreeBytes: () => 100e9, restartDelayMs: 5, killTimeoutMs: 10,
  });
  recorder.start('streamerone', STATUS);
  spawned[0].child.emit('error', new Error('spawn streamlink ENOENT'));
  await vi.waitFor(() => expect(listRecordings(db)[0].status).toBe('failed'));
  expect(recorder.active()).toEqual([]);
  expect(notices).toContain('Recording failed');
});

test('stop resolves even when the child never exits (hard deadline)', async () => {
  class StubbornChild extends FakeChild {
    kill() { this.killed.push('ignored'); return false; } // never exits
  }
  let first = true;
  const bus = createBus();
  const recorder = createRecorder({
    db, dataDir, bus,
    spawnFn: ((cmd: string, args: string[]) => {
      const child = first && cmd === 'streamlink' ? new StubbornChild() : new FakeChild();
      if (cmd === 'streamlink') first = false;
      spawned.push({ cmd, args, child });
      return child;
    }) as any,
    finalizeFn: async (_db, recId) => { finalized.push(recId); },
    chat: { join: () => {}, part: () => {} },
    isLive: () => true, getFreeBytes: () => 100e9, restartDelayMs: 5, killTimeoutMs: 10,
  });
  recorder.start('streamerone', STATUS);
  await recorder.stop('streamerone'); // resolves via hard deadline (10*2+1000 ms max)
  expect(finalized).toHaveLength(1);
});

test('concurrent stops share one in-flight stop', async () => {
  const { recorder } = make();
  recorder.start('streamerone', STATUS);
  const recId = listRecordings(db)[0].id;
  await Promise.all([recorder.stop('streamerone'), recorder.stop('streamerone')]);
  expect(finalized).toEqual([recId]); // finalize ran exactly once
});

test('gives up after repeated immediate exits', async () => {
  const { recorder, bus } = make();
  const bodies: string[] = [];
  bus.on('notify', n => bodies.push(n.body));
  recorder.start('streamerone', STATUS);
  for (let i = 0; i < 5; i++) {
    const sl = spawned.filter(s => s.cmd === 'streamlink');
    sl[sl.length - 1].child.exit(1);
    await new Promise(r => setTimeout(r, 15));
  }
  await vi.waitFor(() => expect(recorder.active()).toEqual([]));
  expect(bodies.some(b => b.includes('giving up'))).toBe(true);
  expect(spawned.filter(s => s.cmd === 'streamlink')).toHaveLength(5);
});

test('same-minute restart gets a distinct directory', async () => {
  const { recorder } = make();
  recorder.start('streamerone', STATUS);
  await recorder.stop('streamerone');
  recorder.start('streamerone', STATUS);
  const dirs = listRecordings(db).map(r => r.dir_path);
  expect(new Set(dirs).size).toBe(2);
});
