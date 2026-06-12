import { expect, test } from 'vitest';
import { buildOsascriptArgs, createNotifier } from './notifier.js';
import { createBus } from './events.js';
import type { StreamStatus } from './types.js';

test('buildOsascriptArgs escapes quotes and backslashes', () => {
  const args = buildOsascriptArgs('Ti"tle', 'Bo\\dy "x"');
  expect(args[0]).toBe('-e');
  expect(args[1]).toBe('display notification "Bo\\\\dy \\"x\\"" with title "Ti\\"tle"');
});

test('notifier reacts to live events and forwards to bus + osascript', () => {
  const bus = createBus();
  const execd: string[][] = [];
  const forwarded: { title: string; body: string }[] = [];
  bus.on('notify', n => forwarded.push(n));
  createNotifier({ bus, execFn: (_cmd, args) => { execd.push(args); } });
  const s: StreamStatus = { login: 'a', displayName: 'A', avatarUrl: '', live: true, title: 'Hi!', game: 'IRL', viewers: 0, startedAt: '' };
  bus.emit('live', s);
  expect(forwarded[0].title).toBe('A is live');
  expect(forwarded[0].body).toBe('Hi!');
  expect(execd).toHaveLength(1);
});

test('notifier sends raw notify events to osascript exactly once', () => {
  const bus = createBus();
  const execd: string[][] = [];
  createNotifier({ bus, execFn: (_cmd, args) => { execd.push(args); } });
  bus.emit('notify', { title: 'T', body: 'B' }); // e.g. from recorder
  expect(execd).toHaveLength(1);
});
