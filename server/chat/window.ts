import fs from 'node:fs';
import readline from 'node:readline';
import type { ChatLine } from '../types.js';

const MAX_LINES = 5000;

export async function readChatWindow(file: string, fromMs: number, toMs: number): Promise<ChatLine[]> {
  if (!fs.existsSync(file)) return [];
  const out: ChatLine[] = [];
  const input = fs.createReadStream(file);
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const raw of rl) {
      if (!raw) continue;
      let line: ChatLine;
      try { line = JSON.parse(raw) as ChatLine; } catch { continue; }
      if (typeof line.t !== 'number') continue;
      if (line.t >= toMs) break; // file is append-ordered (single writer, per-recording file); nothing later matters
      if (line.t >= fromMs) {
        out.push(line);
        if (out.length >= MAX_LINES) break; // file is append-ordered (single writer, per-recording file); nothing later matters
      }
    }
  } finally {
    rl.close();
    input.destroy();
  }
  return out;
}
