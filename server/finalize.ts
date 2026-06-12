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
  const parts = entries.filter(f => /^part-\d+\.ts$/.test(f)).sort();
  if (!parts.length) throw new Error('no part files to finalize');

  await fs.writeFile(path.join(absDir, 'parts.txt'), buildConcatList(parts));
  await exec('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', 'parts.txt',
    '-c', 'copy', '-movflags', '+faststart', 'video.mp4'], { cwd: absDir });

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

  for (const p of [...parts, 'parts.txt']) await fs.rm(path.join(absDir, p), { force: true });

  updateRecording(db, recId, { status: 'ready', ended_at: endedAt, duration_s: duration, size_bytes: size });
}

export async function salvageOnStartup(db: Db, dataDir: string, exec: ExecFn = runExec): Promise<void> {
  for (const rec of listByStatus(db, ['recording', 'finalizing'])) {
    const absDir = path.join(dataDir, rec.dir_path);
    try {
      await finalizeRecording(db, rec.id, absDir, exec);
    } catch {
      updateRecording(db, rec.id, { status: 'failed', ended_at: rec.ended_at ?? nowIso() });
    }
  }
}
