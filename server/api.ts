import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import fs from 'node:fs';
import path from 'node:path';
import type { Bus, BusEvents } from './events.js';
import {
  deleteRecording, deleteStreamer, getRecording, getSetting, getStreamer,
  listRecordings, listStreamers, setSetting, setStreamerFields, totalReadyBytes,
  updateRecording, upsertStreamer, type Db,
} from './db.js';
import { readChatWindow } from './chat/window.js';
import { parseLoginFromInput } from './twitchGql.js';
import { freeDiskBytes } from './cleanup.js';
import type { RecordingRow, StreamStatus } from './types.js';

export interface ApiDeps {
  db: Db;
  bus: Bus;
  dataDir: string;
  watcher: {
    getStatuses: () => StreamStatus[];
    isStale: () => boolean;
    isConsideredLive: (login: string) => boolean;
    requestTick: () => void;
  };
  recorder: {
    active: () => string[];
    start: (login: string, status: StreamStatus) => void;
    stop: (login: string) => Promise<void>;
  };
  resolveUser: (login: string) => Promise<{ login: string; displayName: string; avatarUrl: string } | null>;
  webDistDir: string | null; // null in tests / before first build
}

export function buildStreamerViews(deps: ApiDeps) {
  const statuses = new Map(deps.watcher.getStatuses().map(s => [s.login, s]));
  const active = new Set(deps.recorder.active());
  return listStreamers(deps.db).map(row => {
    const st = statuses.get(row.login);
    return {
      login: row.login,
      displayName: st?.displayName ?? row.display_name,
      avatarUrl: st?.avatarUrl || row.avatar_url,
      autoRecord: Boolean(row.auto_record),
      quality: row.quality,
      lastLiveAt: row.last_live_at,
      live: st?.live ?? false,
      title: st?.title ?? null,
      game: st?.game ?? null,
      viewers: st?.viewers ?? null,
      startedAt: st?.startedAt ?? null,
      recording: active.has(row.login),
    };
  });
}

function rowToDto(r: RecordingRow) {
  return {
    id: r.id, streamerLogin: r.streamer_login,
    startedAt: r.started_at, endedAt: r.ended_at,
    title: r.title, game: r.game, status: r.status,
    sizeBytes: r.size_bytes, durationS: r.duration_s,
    pinned: Boolean(r.pinned), watchedAt: r.watched_at,
    resumePositionS: r.resume_position_s, chatOffsetMs: r.chat_offset_ms,
    videoUrl: `/media/${r.dir_path}/video.mp4`,
    thumbUrl: `/media/${r.dir_path}/thumb.jpg`,
  };
}

export function buildServer(deps: ApiDeps): FastifyInstance {
  const { db, bus, dataDir } = deps;
  // SSE connections never end on their own; without this app.close() waits forever
  const app = Fastify({ forceCloseConnections: true, ajv: { customOptions: { coerceTypes: false } } });

  const recordingsRoot = path.join(dataDir, 'recordings');
  fs.mkdirSync(recordingsRoot, { recursive: true });
  app.register(fastifyStatic, {
    root: recordingsRoot, prefix: '/media/recordings/',
    acceptRanges: true, decorateReply: deps.webDistDir === null,
  });
  if (deps.webDistDir) {
    app.register(fastifyStatic, { root: deps.webDistDir, prefix: '/', decorateReply: true });
    // SPA fallback: any non-API GET serves index.html
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api/') && !req.url.startsWith('/media')) {
        return (reply as any).sendFile('index.html');
      }
      reply.code(404).send({ error: 'not found' });
    });
  }

  // push fresh views to SSE clients right after a mutation — the next poll tick
  // is up to a minute away, and a toggle that takes 60s to render reads as broken
  const pushStatus = () =>
    bus.emit('status', { statuses: deps.watcher.getStatuses(), stale: deps.watcher.isStale() });

  // --- streamers
  app.get('/api/streamers', async () => ({ streamers: buildStreamerViews(deps), stale: deps.watcher.isStale() }));

  app.post('/api/streamers', {
    schema: { body: { type: 'object', required: ['nameOrUrl'], properties: { nameOrUrl: { type: 'string' } }, additionalProperties: false } },
  }, async (req, reply) => {
    const { nameOrUrl } = req.body as { nameOrUrl?: string };
    const login = parseLoginFromInput(nameOrUrl ?? '');
    if (!login) return reply.code(400).send({ error: 'invalid name or URL' });
    const user = await deps.resolveUser(login);
    if (!user) return reply.code(404).send({ error: `no such Twitch channel: ${login}` });
    upsertStreamer(db, { login: user.login, display_name: user.displayName, avatar_url: user.avatarUrl });
    pushStatus();
    deps.watcher.requestTick();
    return reply.code(201).send({ login: user.login });
  });

  app.patch('/api/streamers/:login', {
    schema: { body: { type: 'object', properties: { autoRecord: { type: 'boolean' }, quality: { type: 'string', minLength: 1, maxLength: 100 } }, additionalProperties: false } },
  }, async (req, reply) => {
    const { login } = req.params as { login: string };
    if (!getStreamer(db, login)) return reply.code(404).send({ error: 'unknown streamer' });
    const body = req.body as { autoRecord?: boolean; quality?: string };
    setStreamerFields(db, login, {
      auto_record: body.autoRecord === undefined ? undefined : (body.autoRecord ? 1 : 0),
      quality: body.quality,
    });
    pushStatus();
    return { ok: true };
  });

  app.delete('/api/streamers/:login', async (req) => {
    const { login } = req.params as { login: string };
    if (deps.recorder.active().includes(login)) await deps.recorder.stop(login);
    deleteStreamer(db, login);
    pushStatus();
    return { ok: true };
  });

  app.post('/api/streamers/:login/record/start', async (req, reply) => {
    const { login } = req.params as { login: string };
    const status = deps.watcher.getStatuses().find(s => s.login === login);
    if (!status?.live) return reply.code(409).send({ error: 'streamer is not live' });
    deps.recorder.start(login, status);
    pushStatus();
    return { ok: true };
  });

  app.post('/api/streamers/:login/record/stop', async (req) => {
    const { login } = req.params as { login: string };
    await deps.recorder.stop(login);
    pushStatus();
    return { ok: true };
  });

  // --- recordings
  app.get('/api/recordings', async (req) => {
    const { streamer, sort } = req.query as { streamer?: string; sort?: string };
    const rows = listRecordings(db, streamer || undefined); // already date-desc
    if (sort === 'size') rows.sort((a, b) => b.size_bytes - a.size_bytes);
    return rows.map(rowToDto);
  });

  app.get('/api/recordings/:id', async (req, reply) => {
    const rec = getRecording(db, Number((req.params as any).id));
    if (!rec) return reply.code(404).send({ error: 'not found' });
    return rowToDto(rec);
  });

  app.patch('/api/recordings/:id', {
    schema: { body: { type: 'object', properties: { pinned: { type: 'boolean' }, watchedAt: { type: 'string' }, resumePositionS: { type: 'number', minimum: 0 }, chatOffsetMs: { type: 'integer' } }, additionalProperties: false } },
  }, async (req, reply) => {
    const id = Number((req.params as any).id);
    if (!getRecording(db, id)) return reply.code(404).send({ error: 'not found' });
    const b = req.body as { pinned?: boolean; watchedAt?: string; resumePositionS?: number; chatOffsetMs?: number };
    updateRecording(db, id, {
      pinned: b.pinned === undefined ? undefined : (b.pinned ? 1 : 0),
      watched_at: b.watchedAt,
      resume_position_s: b.resumePositionS,
      chat_offset_ms: b.chatOffsetMs,
    });
    return { ok: true };
  });

  app.delete('/api/recordings/:id', async (req, reply) => {
    const id = Number((req.params as any).id);
    const rec = getRecording(db, id);
    if (!rec) return reply.code(404).send({ error: 'not found' });
    if (rec.status === 'recording' || rec.status === 'finalizing') {
      return reply.code(409).send({ error: 'recording in progress — stop it first' });
    }
    const target = path.resolve(dataDir, rec.dir_path);
    if (!target.startsWith(recordingsRoot + path.sep)) {
      return reply.code(500).send({ error: 'corrupt dir_path — refusing to delete' });
    }
    fs.rmSync(target, { recursive: true, force: true });
    deleteRecording(db, id);
    return { ok: true };
  });

  app.get('/api/recordings/:id/chat', async (req, reply) => {
    const rec = getRecording(db, Number((req.params as any).id));
    if (!rec) return reply.code(404).send({ error: 'not found' });
    const q = req.query as { fromMs?: string; toMs?: string };
    const fromMs = Number(q.fromMs ?? 0);
    const toMs = Number(q.toMs ?? Number.MAX_SAFE_INTEGER);
    return readChatWindow(path.join(dataDir, rec.dir_path, 'chat.jsonl'), fromMs, toMs);
  });

  // --- settings & disk
  app.get('/api/settings', async () => ({
    diskCapGb: Number(getSetting(db, 'disk_cap_gb')),
    pollIntervalS: Number(getSetting(db, 'poll_interval_s')),
    dataDir,
  }));

  app.patch('/api/settings', {
    schema: { body: { type: 'object', properties: { diskCapGb: { type: 'number', exclusiveMinimum: 0 }, pollIntervalS: { type: 'number', minimum: 30 } }, additionalProperties: false } },
  }, async (req, reply) => {
    const b = req.body as { diskCapGb?: number; pollIntervalS?: number };
    if (b.diskCapGb !== undefined) {
      if (!(b.diskCapGb > 0)) return reply.code(400).send({ error: 'diskCapGb must be > 0' });
      setSetting(db, 'disk_cap_gb', String(b.diskCapGb));
    }
    if (b.pollIntervalS !== undefined) {
      if (!(b.pollIntervalS >= 30)) return reply.code(400).send({ error: 'pollIntervalS must be >= 30' });
      setSetting(db, 'poll_interval_s', String(b.pollIntervalS));
    }
    return { ok: true };
  });

  app.get('/api/disk', async () => ({
    usedBytes: totalReadyBytes(db),
    capBytes: Number(getSetting(db, 'disk_cap_gb')) * 1e9,
    freeBytes: await freeDiskBytes(dataDir),
  }));

  // --- SSE
  app.get('/api/events', (req, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    const send = (event: string, data: unknown) =>
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

    send('status', { streamers: buildStreamerViews(deps), stale: deps.watcher.isStale() });

    const onStatus: BusEvents['status'] = () =>
      send('status', { streamers: buildStreamerViews(deps), stale: deps.watcher.isStale() });
    const onRecording: BusEvents['recording'] = r => send('recording', rowToDto(r));
    const onNotify: BusEvents['notify'] = n => send('notify', n);
    bus.on('status', onStatus);
    bus.on('recording', onRecording);
    bus.on('notify', onNotify);
    const heartbeat = setInterval(() => reply.raw.write(': hb\n\n'), 25_000);

    req.raw.on('close', () => {
      clearInterval(heartbeat);
      bus.off('status', onStatus);
      bus.off('recording', onRecording);
      bus.off('notify', onNotify);
    });
  });

  return app;
}
