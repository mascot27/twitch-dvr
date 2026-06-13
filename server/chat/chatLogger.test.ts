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

test('flushes lines queued in the same tick as part (no end-of-stream tail loss)', async () => {
  const logger = make();
  const file = path.join(dir, 'chat.jsonl');
  logger.join('streamerone', file, nowMs);
  sockets[0].fire('open');
  // a final burst arrives, then the stream ends in the same tick (normal end-of-stream PART)
  sockets[0].fire('message', Buffer.from(RAW('streamerone', 'last1') + '\r\n' + RAW('streamerone', 'last2') + '\r\n'));
  logger.part('streamerone'); // end() must be queued AFTER the writes above, not run synchronously
  await logger.flush();
  const content = fs.readFileSync(file, 'utf8');
  expect(content).toContain('last1');
  expect(content).toContain('last2');
});

test('stop() flushes queued lines before the streams end', async () => {
  const logger = make();
  const file = path.join(dir, 'chat.jsonl');
  logger.join('streamerone', file, nowMs);
  sockets[0].fire('open');
  sockets[0].fire('message', Buffer.from(RAW('streamerone', 'goodbye') + '\r\n'));
  logger.stop();          // shutdown path: parts all channels, closes socket
  await logger.flush();   // must still capture the line queued before stop()
  expect(fs.readFileSync(file, 'utf8')).toContain('goodbye');
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

test('parting one of two channels keeps the socket open', () => {
  const logger = make();
  logger.join('a', path.join(dir, 'a.jsonl'), nowMs);
  logger.join('b', path.join(dir, 'b.jsonl'), nowMs);
  sockets[0].fire('open');
  let closed = false;
  const origClose = sockets[0].close.bind(sockets[0]);
  sockets[0].close = () => { closed = true; origClose(); };
  logger.part('a');
  expect(closed).toBe(false);
  logger.part('b');
  expect(closed).toBe(true);
});

test('backoff does not reset on open alone (accept-then-drop storm)', async () => {
  const logger = make(); // reconnectDelayMs: 1
  logger.join('a', path.join(dir, 'a.jsonl'), nowMs);
  sockets[0].fire('open');
  sockets[0].fire('close');           // no message received -> delay doubles to 2
  await new Promise(r => setTimeout(r, 10));
  expect(sockets.length).toBe(2);
  sockets[1].fire('open');            // open alone must NOT reset delay
  sockets[1].fire('close');           // doubles to 4
  await new Promise(r => setTimeout(r, 10));
  expect(sockets.length).toBe(3);
  sockets[2].fire('open');
  sockets[2].fire('message', Buffer.from('PING :tmi.twitch.tv\r\n')); // healthy signal resets
  sockets[2].fire('close');
  await new Promise(r => setTimeout(r, 10));
  expect(sockets.length).toBe(4);
});

test('mixed-case login still routes lowercase channel messages', async () => {
  const logger = make();
  const file = path.join(dir, 'chat.jsonl');
  logger.join('Streamerone', file, nowMs - 1000);
  sockets[0].fire('open');
  expect(sockets[0].sent).toContain('JOIN #streamerone');
  sockets[0].fire('message', Buffer.from(RAW('streamerone', 'hi') + '\r\n'));
  await logger.flush();
  expect(fs.readFileSync(file, 'utf8')).toContain('hi');
});
