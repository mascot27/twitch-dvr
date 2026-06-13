import { afterEach, beforeEach, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readDeletions } from './deletions.js';

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dvr-del-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

test('reads records and skips corrupt lines', async () => {
  const file = path.join(dir, 'deletions.jsonl');
  fs.writeFileSync(file, [
    JSON.stringify({ t: 1000, kind: 'message', user: 'a', targetId: 'm1' }),
    'CORRUPT{{{',
    JSON.stringify({ t: 2000, kind: 'user', user: 'b', durationS: 600 }),
  ].join('\n') + '\n');
  expect(await readDeletions(file)).toEqual([
    { t: 1000, kind: 'message', user: 'a', targetId: 'm1' },
    { t: 2000, kind: 'user', user: 'b', durationS: 600 },
  ]);
});

test('missing file -> empty array', async () => {
  expect(await readDeletions(path.join(dir, 'nope.jsonl'))).toEqual([]);
});
