import { beforeEach, expect, test, vi } from 'vitest';
import { createBus } from './events.js';
import { openDb, upsertStreamer, getStreamer, deleteStreamer, type Db } from './db.js';
import { createWatcher } from './watcher.js';
import type { StreamStatus } from './types.js';

function status(login: string, live: boolean): StreamStatus {
  return { login, displayName: login, avatarUrl: 'av', live,
    title: live ? 'T' : null, game: live ? 'G' : null,
    viewers: live ? 1 : null, startedAt: live ? '2026-06-12T19:00:00Z' : null };
}

let db: Db;
beforeEach(() => {
  db = openDb(':memory:');
  upsertStreamer(db, { login: 'a', display_name: 'a', avatar_url: '' });
});

function make(fetchImpl: () => Promise<StreamStatus[]>) {
  const bus = createBus();
  const events: string[] = [];
  bus.on('live', s => events.push(`live:${s.login}`));
  bus.on('offline', l => events.push(`offline:${l}`));
  const watcher = createWatcher({ db, bus, fetchStatuses: fetchImpl });
  return { bus, events, watcher };
}

test('emits live on offline->live and records last_live_at', async () => {
  const { events, watcher } = make(async () => [status('a', true)]);
  await watcher.tick();
  expect(events).toEqual(['live:a']);
  expect(watcher.isConsideredLive('a')).toBe(true);
  expect(getStreamer(db, 'a')!.last_live_at).not.toBeNull();
  await watcher.tick(); // still live -> no duplicate event
  expect(events).toEqual(['live:a']);
});

test('requires 2 consecutive offline polls before emitting offline', async () => {
  const seq = [
    [status('a', true)], [status('a', false)], [status('a', true)], // flap: no offline
    [status('a', false)], [status('a', false)],                     // 2 in a row -> offline
  ];
  let i = 0;
  const { events, watcher } = make(async () => seq[Math.min(i++, seq.length - 1)]);
  for (let k = 0; k < 5; k++) await watcher.tick();
  expect(events).toEqual(['live:a', 'offline:a']);
  expect(watcher.isConsideredLive('a')).toBe(false);
});

test('marks stale after 5 consecutive fetch failures, keeps last statuses', async () => {
  let fail = false;
  const { watcher } = make(async () => { if (fail) throw new Error('net'); return [status('a', true)]; });
  await watcher.tick();
  expect(watcher.isStale()).toBe(false);
  fail = true;
  for (let k = 0; k < 5; k++) await watcher.tick();
  expect(watcher.isStale()).toBe(true);
  expect(watcher.getStatuses()[0].live).toBe(true); // last known kept
  expect(watcher.isConsideredLive('a')).toBe(true); // failures don't end recordings
  fail = false;
  await watcher.tick();
  expect(watcher.isStale()).toBe(false);
});

test('updates display name/avatar from poll', async () => {
  const { watcher } = make(async () => [{ ...status('a', false), displayName: 'AA', avatarUrl: 'new' }]);
  await watcher.tick();
  const s = getStreamer(db, 'a')!;
  expect(s.display_name).toBe('AA');
  expect(s.avatar_url).toBe('new');
});

test('start() polls on interval from settings', async () => {
  vi.useFakeTimers();
  let calls = 0;
  const { watcher } = make(async () => { calls++; return [status('a', false)]; });
  watcher.start();
  await vi.advanceTimersByTimeAsync(60_000 * 2 + 500);
  expect(calls).toBe(3); // immediate + 2 scheduled
  watcher.stop();
  vi.useRealTimers();
});

test('a throwing live listener does not kill subsequent ticks', async () => {
  const bus = createBus();
  const watcher = createWatcher({ db, bus, fetchStatuses: async () => [status('a', true)] });
  bus.on('live', () => { throw new Error('listener boom'); });
  const statuses: boolean[] = [];
  bus.on('status', () => statuses.push(true));
  await expect(watcher.tick()).rejects.toThrow('listener boom'); // tick itself rejects...
  await watcher.tick(); // ...but the watcher stays functional
  expect(watcher.isConsideredLive('a')).toBe(true);
  expect(statuses.length).toBeGreaterThanOrEqual(1);
});

test('remove-then-re-add while live re-emits live', async () => {
  const { events, watcher } = make(async () => [status('a', true)]);
  await watcher.tick();
  expect(events).toEqual(['live:a']);
  deleteStreamer(db, 'a');
  await watcher.tick(); // prunes state
  upsertStreamer(db, { login: 'a', display_name: 'a', avatar_url: '' });
  await watcher.tick();
  expect(events).toEqual(['live:a', 'live:a']);
});

test('stop() halts polling even when called mid-cycle', async () => {
  vi.useFakeTimers();
  let calls = 0;
  const { watcher } = make(async () => { calls++; return [status('a', false)]; });
  watcher.start();
  await vi.advanceTimersByTimeAsync(60_500);
  watcher.stop();
  const after = calls;
  await vi.advanceTimersByTimeAsync(300_000);
  expect(calls).toBe(after);
  vi.useRealTimers();
});
