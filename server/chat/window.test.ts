import { afterEach, beforeEach, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readChatWindow } from './window.js';

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dvr-win-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

test('returns lines with fromMs <= t < toMs, skipping corrupt lines', async () => {
  const file = path.join(dir, 'chat.jsonl');
  fs.writeFileSync(file, [
    JSON.stringify({ t: 1000, type: 'msg', text: 'a' }),
    'CORRUPT{{{',
    JSON.stringify({ t: 2000, type: 'msg', text: 'b' }),
    JSON.stringify({ t: 3000, type: 'msg', text: 'c' }),
  ].join('\n') + '\n');
  const out = await readChatWindow(file, 1000, 3000);
  expect(out.map(l => l.text)).toEqual(['a', 'b']);
});

test('missing file -> empty array', async () => {
  expect(await readChatWindow(path.join(dir, 'nope.jsonl'), 0, 1000)).toEqual([]);
});
