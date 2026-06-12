import path from 'node:path';
import fs from 'node:fs';
import url from 'node:url';
import WebSocket from 'ws';
import { loadConfig } from './config.js';
import { getSetting, getStreamer, openDb } from './db.js';
import { createBus } from './events.js';
import { fetchStatuses, resolveUser } from './twitchGql.js';
import { createWatcher } from './watcher.js';
import { createChatLogger } from './chat/chatLogger.js';
import { createRecorder, defaultSpawn } from './recorder.js';
import { finalizeRecording, salvageOnStartup } from './finalize.js';
import { freeDiskBytes, runCleanup } from './cleanup.js';
import { createNotifier } from './notifier.js';
import { buildServer } from './api.js';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');

async function main() {
  const config = loadConfig(ROOT);
  fs.mkdirSync(config.dataDir, { recursive: true });
  const db = openDb(path.join(config.dataDir, 'twitch-dvr.db'));
  const bus = createBus();

  const watcher = createWatcher({ db, bus, fetchStatuses });

  const chat = createChatLogger({
    makeSocket: () => new WebSocket('wss://irc-ws.chat.twitch.tv:443') as never,
  });

  // cached free-disk value, refreshed every 5 min and at boot
  let freeBytes = Number.MAX_SAFE_INTEGER;
  let lastDiskWarnAt = 0;
  async function refreshDisk() {
    try { freeBytes = await freeDiskBytes(config.dataDir); } catch { /* keep last value */ }
    if (freeBytes < 10e9 && Date.now() - lastDiskWarnAt > 3_600_000) {
      lastDiskWarnAt = Date.now();
      bus.emit('disk-low', { freeBytes });
    }
  }
  await refreshDisk();
  setInterval(refreshDisk, 5 * 60_000);

  const recorder = createRecorder({
    db, dataDir: config.dataDir, bus,
    spawnFn: defaultSpawn,
    finalizeFn: finalizeRecording,
    chat,
    isLive: l => watcher.isConsideredLive(l),
    getFreeBytes: () => freeBytes,
  });

  createNotifier({ bus });

  bus.on('live', s => {
    if (getStreamer(db, s.login)?.auto_record) recorder.start(s.login, s);
  });
  bus.on('offline', login => {
    recorder.stop(login).catch(err => console.error('[main] stop failed:', err));
  });
  bus.on('recording', r => {
    if (r.status === 'ready') {
      try { runCleanup(db, config.dataDir, Number(getSetting(db, 'disk_cap_gb'))); }
      catch (err) { console.error('[main] cleanup failed:', err); }
    }
  });
  setInterval(() => {
    try { runCleanup(db, config.dataDir, Number(getSetting(db, 'disk_cap_gb'))); }
    catch (err) { console.error('[main] cleanup failed:', err); }
  }, 3_600_000);

  // salvage recordings orphaned by a crash/reboot before serving anything
  await salvageOnStartup(db, config.dataDir);

  const webDist = path.join(ROOT, 'web', 'dist');
  const app = buildServer({
    db, bus, dataDir: config.dataDir,
    watcher: { ...watcher, requestTick: () => void watcher.tick() },
    recorder,
    resolveUser,
    webDistDir: fs.existsSync(path.join(webDist, 'index.html')) ? webDist : null,
  });

  await app.listen({ port: config.port, host: '127.0.0.1' });
  watcher.start();
  console.log(`twitch-dvr listening on http://localhost:${config.port} — data in ${config.dataDir}`);

  let shuttingDown = false;
  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, async () => {
      if (shuttingDown) return;
      shuttingDown = true;
      console.log(`${sig}: finalizing active recordings…`);
      watcher.stop();
      await recorder.stopAll(); // kills streamlink, finalizes mp4s
      chat.stop();
      await app.close();
      process.exit(0);
    });
  }
}

main().catch(err => { console.error(err); process.exit(1); });
