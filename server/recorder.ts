import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { Bus } from './events.js';
import { getRecording, getStreamer, insertRecording, updateRecording, type Db } from './db.js';
import { nowIso, slugify, timestampForDir } from './util.js';
import type { StreamStatus } from './types.js';

export interface ChildLike {
  pid?: number;
  exitCode: number | null;
  kill(signal?: NodeJS.Signals | number): boolean;
  on(ev: 'exit', cb: (code: number | null) => void): unknown;
  on(ev: 'error', cb: (err: Error) => void): unknown;
}

export interface RecorderDeps {
  db: Db;
  dataDir: string;
  bus: Bus;
  spawnFn: (cmd: string, args: string[], opts?: object) => ChildLike;
  finalizeFn: (db: Db, recId: number, absDir: string) => Promise<void>;
  chat: { join(login: string, filePath: string, startedAtMs: number): void; part(login: string): void };
  isLive: (login: string) => boolean; // watcher.isConsideredLive
  getFreeBytes: () => number;         // cached free-disk value
  restartDelayMs?: number;
  killTimeoutMs?: number;
}

export interface Recorder {
  start(login: string, status: StreamStatus): void;
  stop(login: string): Promise<void>;
  active(): string[];
  stopAll(): Promise<void>;
}

export const MIN_FREE_BYTES = 10e9;
const FAST_FAIL_MS = 30_000;   // a part that dies faster than this counts as a failure
const FAST_FAIL_LIMIT = 5;     // consecutive fast failures before giving up

interface Job {
  recId: number;
  login: string;
  absDir: string;
  partNo: number;
  quality: string;
  child: ChildLike | null;
  caffeinate: ChildLike | null;
  errFd: number | null;
  timer: NodeJS.Timeout | null;
  stopping: boolean;
  fastFails: number;
  spawnedAt: number;
  spawnFailed: boolean;
}

export const defaultSpawn = (cmd: string, args: string[], opts?: object): ChildLike =>
  spawn(cmd, args, { stdio: 'ignore', ...opts }) as unknown as ChildLike;

export function createRecorder(deps: RecorderDeps): Recorder {
  const jobs = new Map<string, Job>();
  const stopsInFlight = new Map<string, Promise<void>>();
  const restartDelay = deps.restartDelayMs ?? 10_000;
  const killTimeout = deps.killTimeoutMs ?? 10_000;

  function closeErrFd(job: Job) {
    if (job.errFd !== null) {
      try { fs.closeSync(job.errFd); } catch { /* already closed */ }
      job.errFd = null;
    }
  }

  function abandon(job: Job, reason: string) {
    deps.bus.emit('notify', { title: 'Recording failed', body: `${job.login}: ${reason}` });
    stop(job.login).catch(err => console.error(`[recorder] stop after failure (${job.login}):`, err));
  }

  function spawnPart(job: Job) {
    const out = path.join(job.absDir, `part-${String(job.partNo).padStart(3, '0')}.ts`);
    try { job.errFd = fs.openSync(path.join(job.absDir, 'streamlink.log'), 'a'); } catch { job.errFd = null; }
    job.spawnedAt = Date.now();
    job.child = deps.spawnFn('streamlink', [
      '--twitch-disable-ads', '--hls-live-restart',
      `twitch.tv/${job.login}`, job.quality, '-o', out,
    ], { stdio: ['ignore', 'ignore', job.errFd ?? 'ignore'] });
    job.child.on('error', (err: Error) => {
      // a missing/broken streamlink binary emits 'error' and never 'exit';
      // without this handler the whole daemon would crash
      closeErrFd(job);
      job.spawnFailed = true;
      if (job.stopping) return;
      abandon(job, `streamlink could not start — ${err.message}`);
    });
    job.child.on('exit', () => {
      closeErrFd(job);
      if (job.stopping) return;
      job.fastFails = Date.now() - job.spawnedAt < FAST_FAIL_MS ? job.fastFails + 1 : 0;
      if (job.fastFails >= FAST_FAIL_LIMIT) {
        abandon(job, `streamlink keeps exiting immediately (${FAST_FAIL_LIMIT}x) — giving up`);
        return;
      }
      if (deps.getFreeBytes() < MIN_FREE_BYTES) {
        abandon(job, 'disk almost full — recording stopped');
        return;
      }
      if (deps.isLive(job.login)) {
        job.partNo++;
        job.timer = setTimeout(() => spawnPart(job), restartDelay);
      } else {
        stop(job.login).catch(err => console.error(`[recorder] stop (${job.login}):`, err));
      }
    });
  }

  function start(login: string, status: StreamStatus): void {
    if (jobs.has(login)) return;
    if (deps.getFreeBytes() < MIN_FREE_BYTES) {
      deps.bus.emit('notify', { title: 'Recording blocked — disk almost full', body: `Not recording ${login}: less than 10 GB free.` });
      return;
    }
    const quality = getStreamer(deps.db, login)?.quality ?? 'best';
    const dirName = `${timestampForDir()}_${slugify(status.title ?? 'stream')}`;
    let dirPath = path.join('recordings', login, dirName);
    let absDir = path.join(deps.dataDir, dirPath);
    // timestamp is minute-granular: a quick stop/start must not reuse the dir
    // (two sessions sharing one dir would silently concat into one video)
    for (let n = 2; fs.existsSync(absDir); n++) {
      dirPath = path.join('recordings', login, `${dirName}-${n}`);
      absDir = path.join(deps.dataDir, dirPath);
    }
    fs.mkdirSync(absDir, { recursive: true });
    const recId = insertRecording(deps.db, {
      streamer_login: login, started_at: nowIso(),
      title: status.title ?? '', game: status.game ?? '', dir_path: dirPath,
    });
    const job: Job = {
      recId, login, absDir, partNo: 1, quality,
      child: null, caffeinate: null, errFd: null, timer: null,
      stopping: false, fastFails: 0, spawnedAt: 0, spawnFailed: false,
    };
    jobs.set(login, job);
    deps.chat.join(login, path.join(absDir, 'chat.jsonl'), Date.now());
    spawnPart(job);
    // one idle-sleep assertion per job, not per part (no gap during part restarts);
    // -w <daemon pid> makes it self-clean if the daemon dies without stop()
    job.caffeinate = deps.spawnFn('caffeinate', ['-i', '-w', String(process.pid)]);
    job.caffeinate.on('error', () => { /* missing caffeinate must not affect recording */ });
    const row = getRecording(deps.db, recId);
    if (row) deps.bus.emit('recording', row);
  }

  function waitExit(child: ChildLike, timeoutMs: number): Promise<void> {
    return new Promise(resolve => {
      if (child.exitCode !== null) return resolve();
      let done = false;
      const finish = () => { if (!done) { done = true; clearTimeout(killT); clearTimeout(deadline); resolve(); } };
      const killT = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
      // hard deadline: a child that never emits 'exit' (failed spawn) must not hang shutdown
      const deadline = setTimeout(finish, timeoutMs * 2 + 1000);
      child.on('exit', finish);
      child.on('error', finish);
    });
  }

  async function doStop(job: Job): Promise<void> {
    jobs.delete(job.login);
    job.stopping = true;
    if (job.timer) clearTimeout(job.timer);
    deps.chat.part(job.login);
    if (job.child && job.child.exitCode === null && !job.spawnFailed) {
      job.child.kill('SIGINT'); // streamlink flushes the output file on SIGINT
      await waitExit(job.child, killTimeout);
    }
    closeErrFd(job);
    job.caffeinate?.kill('SIGTERM');
    updateRecording(deps.db, job.recId, { status: 'finalizing', ended_at: nowIso() });
    const mid = getRecording(deps.db, job.recId);
    if (mid) deps.bus.emit('recording', mid);
    try {
      await deps.finalizeFn(deps.db, job.recId, job.absDir);
    } catch (err) {
      updateRecording(deps.db, job.recId, { status: 'failed' });
      deps.bus.emit('notify', { title: 'Recording failed', body: `${job.login}: finalize error — ${String(err)}` });
    }
    const row = getRecording(deps.db, job.recId);
    if (row) deps.bus.emit('recording', row);
  }

  function stop(login: string): Promise<void> {
    // a job present in `jobs` is by construction not being stopped yet
    // (doStop deletes it synchronously first) — only fall back to a shared
    // in-flight stop when there is no current job, so a stop of generation N
    // never shadows the stop of a restarted generation N+1
    const job = jobs.get(login);
    if (!job) return stopsInFlight.get(login) ?? Promise.resolve();
    const p = doStop(job).finally(() => {
      if (stopsInFlight.get(login) === p) stopsInFlight.delete(login);
    });
    stopsInFlight.set(login, p);
    return p;
  }

  return {
    start, stop,
    active: () => [...jobs.keys()],
    async stopAll() {
      const results = await Promise.allSettled([...jobs.keys()].map(stop));
      for (const r of results) {
        if (r.status === 'rejected') console.error('[recorder] stopAll:', r.reason);
      }
    },
  };
}
