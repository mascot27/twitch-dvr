import fs from 'node:fs';
import readline from 'node:readline';
import type { ChatLine } from '../types.js';

const MAX_LINES = 5000;

export async function readChatWindow(file: string, fromMs: number, toMs: number): Promise<ChatLine[]> {
  if (!fs.existsSync(file)) return [];
  const out: ChatLine[] = [];
  const rl = readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity });
  for await (const raw of rl) {
    if (!raw) continue;
    let line: ChatLine;
    try { line = JSON.parse(raw) as ChatLine; } catch { continue; }
    if (typeof line.t !== 'number') continue;
    if (line.t >= toMs) break; // file is append-ordered; nothing later matters
    if (line.t >= fromMs) {
      out.push(line);
      if (out.length >= MAX_LINES) break;
    }
  }
  rl.close();
  return out;
}
