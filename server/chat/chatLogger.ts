import fs from 'node:fs';
import { parseIrcLine, toChatLine } from './irc.js';

export interface SocketLike {
  on(ev: string, cb: (...a: any[]) => void): void;
  send(d: string): void;
  close(): void;
}

export interface ChatLoggerDeps {
  makeSocket: () => SocketLike; // default in prod: () => new WebSocket('wss://irc-ws.chat.twitch.tv:443')
  now?: () => number;
  reconnectDelayMs?: number;
}

export interface ChatLogger {
  join(login: string, filePath: string, recordingStartedAtMs: number): void;
  part(login: string): void;
  stop(): void;
  flush(): Promise<void>; // for tests: wait for pending writes
}

interface Channel { stream: fs.WriteStream; startedAtMs: number }

export function createChatLogger(deps: ChatLoggerDeps): ChatLogger {
  const now = deps.now ?? Date.now;
  const channels = new Map<string, Channel>();
  let sock: SocketLike | null = null;
  let open = false;
  let stopped = false;
  let reconnectDelay = deps.reconnectDelayMs ?? 1000;
  let pending: Promise<void> = Promise.resolve();

  function connect() {
    if (sock || stopped) return;
    const s = (sock = deps.makeSocket());
    s.on('open', () => {
      open = true;
      reconnectDelay = deps.reconnectDelayMs ?? 1000;
      s.send('CAP REQ :twitch.tv/tags twitch.tv/commands');
      s.send(`NICK justinfan${10000 + Math.floor(Math.random() * 80000)}`);
      for (const login of channels.keys()) s.send(`JOIN #${login}`);
    });
    s.on('message', (data: Buffer | string) => {
      for (const raw of String(data).split('\r\n')) {
        const m = parseIrcLine(raw);
        if (!m) continue;
        if (m.command === 'PING') { s.send(`PONG :${m.params[0] ?? 'tmi.twitch.tv'}`); continue; }
        const chanName = (m.params[0] ?? '').replace(/^#/, '');
        const chan = channels.get(chanName);
        if (!chan) continue;
        const line = toChatLine(m, Math.max(0, now() - chan.startedAtMs));
        if (line) {
          pending = pending.then(() => new Promise<void>(res => chan.stream.write(JSON.stringify(line) + '\n', () => res())));
        }
      }
    });
    s.on('close', () => {
      open = false;
      sock = null;
      if (!stopped && channels.size > 0) {
        setTimeout(connect, reconnectDelay);
        reconnectDelay = Math.min(reconnectDelay * 2, 30_000);
      }
    });
    s.on('error', () => { /* close follows; reconnect handles it */ });
  }

  function part(login: string): void {
    const chan = channels.get(login);
    if (!chan) return;
    channels.delete(login);
    chan.stream.end();
    if (open && sock) sock.send(`PART #${login}`);
    if (!channels.size && sock) sock.close();
  }

  return {
    join(login, filePath, recordingStartedAtMs) {
      if (channels.has(login)) return;
      const stream = fs.createWriteStream(filePath, { flags: 'a' });
      stream.on('error', () => { /* ignore; e.g. dir removed in tests */ });
      channels.set(login, { stream, startedAtMs: recordingStartedAtMs });
      if (open && sock) sock.send(`JOIN #${login}`);
      else connect();
    },
    part,
    stop() {
      stopped = true;
      for (const login of [...channels.keys()]) part(login);
      if (sock) sock.close();
    },
    flush() { return pending; },
  };
}
