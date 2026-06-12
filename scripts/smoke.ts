import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { openDb, upsertStreamer, listRecordings } from '../server/db.js';
import { createBus } from '../server/events.js';
import { fetchStatuses, resolveUser } from '../server/twitchGql.js';
import { createChatLogger } from '../server/chat/chatLogger.js';
import { createRecorder, defaultSpawn } from '../server/recorder.js';
import { finalizeRecording } from '../server/finalize.js';

const login = process.argv[2];
const seconds = Number(process.argv[3] ?? 60);
if (!login) { console.error('usage: npm run smoke -- <login> [seconds]'); process.exit(1); }

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dvr-smoke-'));
const db = openDb(path.join(dataDir, 'smoke.db'));
const bus = createBus();
bus.on('notify', n => console.log('[notify]', n.title, '—', n.body));

const user = await resolveUser(login);
if (!user) { console.error(`no such channel: ${login}`); process.exit(1); }
upsertStreamer(db, { login: user.login, display_name: user.displayName, avatar_url: user.avatarUrl });

const [status] = await fetchStatuses([login]);
if (!status.live) { console.error(`${login} is not live right now — try another channel`); process.exit(1); }
console.log(`${login} is live: "${status.title}" — recording ${seconds}s into ${dataDir}`);

const chat = createChatLogger({ makeSocket: () => new WebSocket('wss://irc-ws.chat.twitch.tv:443') as never });
const recorder = createRecorder({
  db, dataDir, bus, spawnFn: defaultSpawn, finalizeFn: finalizeRecording,
  chat, isLive: () => true, getFreeBytes: () => 100e9,
});

recorder.start(login, status);
await new Promise(r => setTimeout(r, seconds * 1000));
console.log('stopping…');
await recorder.stop(login);
chat.stop();

const [rec] = listRecordings(db);
const dir = path.join(dataDir, rec.dir_path);
console.log(`status: ${rec.status}`);
console.log(`dir:    ${dir}`);
for (const f of fs.readdirSync(dir)) {
  console.log(`  ${f}  ${(fs.statSync(path.join(dir, f)).size / 1e6).toFixed(2)} MB`);
}
const chatLines = fs.existsSync(path.join(dir, 'chat.jsonl'))
  ? fs.readFileSync(path.join(dir, 'chat.jsonl'), 'utf8').trim().split('\n').filter(Boolean).length : 0;
console.log(`chat lines: ${chatLines}`);
console.log(rec.status === 'ready' ? 'SMOKE OK' : 'SMOKE FAILED');
process.exit(rec.status === 'ready' ? 0 : 1);
