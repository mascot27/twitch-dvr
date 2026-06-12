import fs from 'node:fs';
import path from 'node:path';
import { deleteRecording, listByStatus, type Db } from './db.js';
import type { RecordingRow } from './types.js';

type CleanupCandidate = Pick<RecordingRow, 'id' | 'size_bytes' | 'pinned' | 'started_at' | 'status'>;

export function pickDeletions(recs: CleanupCandidate[], capBytes: number): number[] {
  const ready = recs.filter(r => r.status === 'ready');
  let total = ready.reduce((s, r) => s + r.size_bytes, 0);
  const victims: number[] = [];
  const deletable = ready.filter(r => !r.pinned)
    .sort((a, b) => a.started_at.localeCompare(b.started_at) || a.id - b.id);
  for (const r of deletable) {
    if (total <= capBytes) break;
    victims.push(r.id);
    total -= r.size_bytes;
  }
  return victims;
}

export function runCleanup(db: Db, dataDir: string, capGb: number): number[] {
  const recs = listByStatus(db, ['ready']);
  const victims = pickDeletions(recs, capGb * 1e9);
  const deleted: number[] = [];
  for (const id of victims) {
    const rec = recs.find(r => r.id === id)!;
    // one undeletable dir must not wedge cleanup (oldest-first retries it forever)
    // or throw into the caller's timer; skip it and keep freeing space
    try {
      fs.rmSync(path.join(dataDir, rec.dir_path), { recursive: true, force: true });
      deleteRecording(db, id);
      deleted.push(id);
    } catch (err) {
      console.error(`[cleanup] could not delete ${rec.dir_path}:`, err);
    }
  }
  return deleted;
}

export async function freeDiskBytes(dir: string): Promise<number> {
  const s = await fs.promises.statfs(dir);
  return Number(s.bavail) * Number(s.bsize);
}
