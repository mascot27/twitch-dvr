import fs from 'node:fs';
import readline from 'node:readline';
import type { DeletionRecord } from '../types.js';

export async function readDeletions(file: string): Promise<DeletionRecord[]> {
  if (!fs.existsSync(file)) return [];
  const out: DeletionRecord[] = [];
  const input = fs.createReadStream(file);
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const raw of rl) {
      if (!raw) continue;
      let rec: DeletionRecord;
      try { rec = JSON.parse(raw) as DeletionRecord; } catch { continue; }
      if (typeof rec.t === 'number' && (rec.kind === 'message' || rec.kind === 'user')) out.push(rec);
    }
  } finally {
    rl.close();
    input.destroy(); // release the fd even though we read the whole (small) file
  }
  return out;
}
