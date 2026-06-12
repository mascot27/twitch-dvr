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
}

export interface RecorderDeps {
  db: Db;
  dataDir: string;
  bus: Bus;
  spawnFn: (cmd: string, args: string[], opts?: object) => ChildLike;
  finalizeFn: (db: Db, recId: number, absDir: string) => Promise<void>;
  chat: { join(login: string, filePath: string, startedAtMs: number): void; part(login: string): void };
  isLive: (login: string) => boolean;
  getFreeBytes: () => number;
  restartDelayMs?: number;
}

export interface Recorder {
  start(login: string, status: StreamStatus): void;
  stop(login: string): Promise<void>;
  active(): string[];
  stopAll(): Promise<void>;
}

const MIN_FREE_BYTES = 10e9;

interface Job {
  recId: number;
  login: string;
  absDir: string;
  partNo: number;
  child: ChildLike | null;
  caffeinate: ChildLike | null;
  timer: NodeJS.Timeout | null;
  stopping: boolean;
  quality: string;
}

export const defaultSpawn = (cmd: string, args: string[], opts?: object): ChildLike =>
  spawn(cmd, args, { stdio: 'ignore', ...opts }) as unknown as ChildLike;

export function createRecorder(deps: RecorderDeps): Recorder {
  const jobs = new Map<string, Job>();
  const restartDelay = deps.restartDelayMs ?? 10_000;

  function spawnPart(job: Job) {
    const out = path.join(job.absDir, `part-${String(job.partNo).padStart(3, '0')}.ts`);
    job.child = deps.spawnFn('streamlink', [
      '--twitch-disable-ads', '--hls-live-restart',
      `twitch.tv/${job.login}`, job.quality, '-o', out,
    ]);
    if (job.child.pid) {
      job.caffeinate = deps.spawnFn('caffeinate', ['-i', '-w', String(job.child.pid)]);
    }
    job.child.on('exit', () => {
      if (job.stopping) return;
      if (deps.isLive(job.login)) {
        job.partNo++;
        job.timer = setTimeout(() => spawnPart(job), restartDelay);
      } else {
        void stop(job.login);
      }
    });
  }

  function start(login: string, status: StreamStatus): void {
    if (jobs.has(login)) return;
    if (deps.getFreeBytes() < MIN_FREE_BYTES) {
      deps.bus.emit('notify', {
        title: 'Recording blocked — disk almost full',
        body: `Not recording ${login}: less than 10 GB free.`,
      });
      return;
    }
    const quality = getStreamer(deps.db, login)?.quality ?? 'best';
    const dirName = `${timestampForDir()}_${slugify(status.title ?? 'stream')}`;
    const dirPath = path.join('recordings', login, dirName);
    const absDir = path.join(deps.dataDir, dirPath);
    fs.mkdirSync(absDir, { recursive: true });
    const recId = insertRecording(deps.db, {
      streamer_login: login,
      started_at: nowIso(),
      title: status.title ?? '',
      game: status.game ?? '',
      dir_path: dirPath,
    });
    const job: Job = {
      recId, login, absDir, partNo: 1,
      child: null, caffeinate: null, timer: null,
      stopping: false, quality,
    };
    jobs.set(login, job);
    deps.chat.join(login, path.join(absDir, 'chat.jsonl'), Date.now());
    spawnPart(job);
    const row = getRecording(deps.db, recId);
    if (row) deps.bus.emit('recording', row);
  }

  function waitExit(child: ChildLike, timeoutMs: number): Promise<void> {
    return new Promise(resolve => {
      if (child.exitCode !== null) return resolve();
      const to = setTimeout(() => { child.kill('SIGKILL'); }, timeoutMs);
      child.on('exit', () => { clearTimeout(to); resolve(); });
    });
  }

  async function stop(login: string): Promise<void> {
    const job = jobs.get(login);
    if (!job) return;
    jobs.delete(login);
    job.stopping = true;
    if (job.timer) clearTimeout(job.timer);
    deps.chat.part(login);
    if (job.child && job.child.exitCode === null) {
      job.child.kill('SIGINT');
      await waitExit(job.child, 10_000);
    }
    updateRecording(deps.db, job.recId, { status: 'finalizing', ended_at: nowIso() });
    const mid = getRecording(deps.db, job.recId);
    if (mid) deps.bus.emit('recording', mid);
    try {
      await deps.finalizeFn(deps.db, job.recId, job.absDir);
    } catch (err) {
      updateRecording(deps.db, job.recId, { status: 'failed' });
      deps.bus.emit('notify', {
        title: 'Recording failed',
        body: `${login}: finalize error — ${String(err)}`,
      });
    }
    const row = getRecording(deps.db, job.recId);
    if (row) deps.bus.emit('recording', row);
  }

  return {
    start,
    stop,
    active: () => [...jobs.keys()],
    async stopAll() { await Promise.all([...jobs.keys()].map(stop)); },
  };
}
