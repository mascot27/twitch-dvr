import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getRecording, listByStatus, updateRecording, type Db } from './db.js';
import { nowIso } from './util.js';

export type ExecFn = (cmd: string, args: string[], opts: { cwd: string }) => Promise<string>;

const pExecFile = promisify(execFile);
export const runExec: ExecFn = async (cmd, args, opts) => {
  const { stdout } = await pExecFile(cmd, args, { ...opts, maxBuffer: 16 * 1024 * 1024 });
  return stdout ?? '';
};

export function buildConcatList(parts: string[]): string {
  return parts.map(p => `file '${p}'`).join('\n') + '\n';
}

export async function finalizeRecording(db: Db, recId: number, absDir: string, exec: ExecFn = runExec): Promise<void> {
  const rec = getRecording(db, recId);
  if (!rec) throw new Error(`recording ${recId} not found`);

  const entries = await fs.readdir(absDir);
  const parts = entries.filter(f => /^part-\d+\.ts$/.test(f))
    .sort((a, b) => parseInt(a.slice(5), 10) - parseInt(b.slice(5), 10));
  const videoExists = await fs.stat(path.join(absDir, 'video.mp4')).then(() => true, () => false);
  if (parts.length) {
    await fs.writeFile(path.join(absDir, 'parts.txt'), buildConcatList(parts));
    // -c copy concat: parts + output coexist until cleanup, so peak disk is ~2x
    // the recording size (faststart adds a temp file on top)
    await exec('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', 'parts.txt',
      '-c', 'copy', '-movflags', '+faststart', 'video.mp4'], { cwd: absDir });
  } else if (!videoExists) {
    throw new Error('no part files to finalize');
  }
  // else: crash-recovery — parts already cleaned, completed video.mp4 present; skip concat

  const durOut = await exec('ffprobe', ['-v', 'error', '-show_entries', 'format=duration',
    '-of', 'csv=p=0', 'video.mp4'], { cwd: absDir });
  const duration = Number.parseFloat(durOut.trim()) || 0;

  const seek = duration >= 60 ? 30 : Math.floor(duration / 2);
  try {
    await exec('ffmpeg', ['-y', '-ss', String(seek), '-i', 'video.mp4',
      '-frames:v', '1', '-vf', 'scale=480:-2', 'thumb.jpg'], { cwd: absDir });
  } catch { /* thumbnail is optional */ }

  let size = 0;
  for (const f of ['video.mp4', 'chat.jsonl', 'thumb.jpg']) {
    try { size += (await fs.stat(path.join(absDir, f))).size; } catch { /* optional file */ }
  }

  const endedAt = rec.ended_at ?? nowIso();
  await fs.writeFile(path.join(absDir, 'meta.json'), JSON.stringify({
    login: rec.streamer_login, title: rec.title, game: rec.game,
    started_at: rec.started_at, ended_at: endedAt, duration_s: duration,
  }, null, 2));

  updateRecording(db, recId, { status: 'ready', ended_at: endedAt, duration_s: duration, size_bytes: size });
  // deletion last: a crash here leaves stray parts on a 'ready' row (benign),
  // never a 'finalizing' row with half its parts gone (re-concat would truncate)
  for (const p of [...parts, 'parts.txt']) await fs.rm(path.join(absDir, p), { force: true });
}

export async function salvageOnStartup(db: Db, dataDir: string, exec: ExecFn = runExec): Promise<void> {
  for (const rec of listByStatus(db, ['recording', 'finalizing'])) {
    const absDir = path.join(dataDir, rec.dir_path);
    try {
      await finalizeRecording(db, rec.id, absDir, exec);
    } catch (err) {
      console.error(`[finalize] salvage failed for ${rec.dir_path}:`, err);
      updateRecording(db, rec.id, { status: 'failed', ended_at: rec.ended_at ?? nowIso() });
    }
  }
}
