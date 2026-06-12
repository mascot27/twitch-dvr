import { afterEach, beforeEach, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createChatLogger, type SocketLike } from './chatLogger.js';

class FakeSocket implements SocketLike {
  sent: string[] = [];
  handlers = new Map<string, ((...a: any[]) => void)[]>();
  on(ev: string, cb: (...a: any[]) => void) {
    if (!this.handlers.has(ev)) this.handlers.set(ev, []);
    this.handlers.get(ev)!.push(cb);
  }
  send(d: string) { this.sent.push(d); }
  close() { this.fire('close'); }
  fire(ev: string, ...a: any[]) { for (const cb of this.handlers.get(ev) ?? []) cb(...a); }
}

let dir: string;
let sockets: FakeSocket[];
let nowMs: number;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dvr-chat-'));
  sockets = [];
  nowMs = 1_000_000;
});
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

function make() {
  return createChatLogger({
    makeSocket: () => { const s = new FakeSocket(); sockets.push(s); return s; },
    now: () => nowMs,
    reconnectDelayMs: 1,
  });
}

const RAW = (chan: string, text: string) =>
  `@display-name=Fan;color=#FFF;badges=;emotes= :fan!fan@fan.tmi.twitch.tv PRIVMSG #${chan} :${text}`;

test('connects on first join, sends handshake and JOIN', () => {
  const logger = make();
  logger.join('streamerone', path.join(dir, 'chat.jsonl'), nowMs);
  expect(sockets).toHaveLength(1);
  sockets[0].fire('open');
  expect(sockets[0].sent[0]).toContain('CAP REQ :twitch.tv/tags twitch.tv/commands');
  expect(sockets[0].sent[1]).toMatch(/^NICK justinfan\d+$/);
  expect(sockets[0].sent).toContain('JOIN #streamerone');
});

test('writes routed PRIVMSG as jsonl with t relative to recording start', async () => {
  const logger = make();
  const file = path.join(dir, 'chat.jsonl');
  logger.join('streamerone', file, nowMs - 5000); // recording started 5s ago
  sockets[0].fire('open');
  sockets[0].fire('message', Buffer.from(RAW('streamerone', 'hello') + '\r\n' + RAW('other', 'nope') + '\r\n'));
  await logger.flush();
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n').map(l => JSON.parse(l));
  expect(lines).toHaveLength(1); // #other not joined -> dropped
  expect(lines[0].text).toBe('hello');
  expect(lines[0].t).toBe(5000);
});

test('responds to PING and stops writing after part', async () => {
  const logger = make();
  const file = path.join(dir, 'chat.jsonl');
  logger.join('streamerone', file, nowMs);
  sockets[0].fire('open');
  sockets[0].fire('message', Buffer.from('PING :tmi.twitch.tv\r\n'));
  expect(sockets[0].sent).toContain('PONG :tmi.twitch.tv');
  logger.part('streamerone');
  expect(sockets[0].sent).toContain('PART #streamerone');
  sockets[0].fire('message', Buffer.from(RAW('streamerone', 'late') + '\r\n'));
  await logger.flush();
  expect(fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '').not.toContain('late');
});

test('reconnects and re-JOINs active channels after close', async () => {
  const logger = make();
  logger.join('streamerone', path.join(dir, 'chat.jsonl'), nowMs);
  sockets[0].fire('open');
  sockets[0].fire('close');
  await new Promise(r => setTimeout(r, 20));
  expect(sockets.length).toBe(2);
  sockets[1].fire('open');
  expect(sockets[1].sent).toContain('JOIN #streamerone');
});
