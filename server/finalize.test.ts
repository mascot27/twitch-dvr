import { afterEach, beforeEach, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildConcatList, finalizeRecording, salvageOnStartup, type ExecFn } from './finalize.js';
import { getRecording, insertRecording, openDb, updateRecording, upsertStreamer, type Db } from './db.js';

let db: Db; let dataDir: string; let absDir: string; let recId: number;
let calls: { cmd: string; args: string[] }[];

beforeEach(() => {
  db = openDb(':memory:');
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dvr-fin-'));
  upsertStreamer(db, { login: 'x', display_name: 'X', avatar_url: '' });
  recId = insertRecording(db, { streamer_login: 'x', started_at: '2026-06-12T19:00:00Z', title: 'T', game: 'G', dir_path: 'recordings/x/d' });
  absDir = path.join(dataDir, 'recordings/x/d');
  fs.mkdirSync(absDir, { recursive: true });
  calls = [];
});
afterEach(() => { fs.rmSync(dataDir, { recursive: true, force: true }); });

// fake exec: ffmpeg concat -> creates video.mp4; ffprobe -> duration; thumbnail -> thumb.jpg
const fakeExec: ExecFn = async (cmd, args, opts) => {
  calls.push({ cmd, args });
  const cwd = (opts as { cwd: string }).cwd;
  if (cmd === 'ffmpeg' && args.includes('concat')) fs.writeFileSync(path.join(cwd, 'video.mp4'), 'VIDEODATA');
  if (cmd === 'ffmpeg' && args.includes('-frames:v')) fs.writeFileSync(path.join(cwd, 'thumb.jpg'), 'JPG');
  if (cmd === 'ffprobe') return '4520.25\n';
  return '';
};

test('buildConcatList formats entries (inputs are regex-constrained part names)', () => {
  expect(buildConcatList(['part-001.ts', 'part-002.ts'])).toBe("file 'part-001.ts'\nfile 'part-002.ts'\n");
});

test('finalizeRecording: concat, probe, thumb, sizes, cleanup of parts', async () => {
  fs.writeFileSync(path.join(absDir, 'part-001.ts'), 'AAAA');
  fs.writeFileSync(path.join(absDir, 'part-002.ts'), 'BB');
  fs.writeFileSync(path.join(absDir, 'chat.jsonl'), '{"t":1}\n');
  await finalizeRecording(db, recId, absDir, fakeExec);
  const rec = getRecording(db, recId)!;
  expect(rec.status).toBe('ready');
  expect(rec.duration_s).toBeCloseTo(4520.25);
  expect(rec.size_bytes).toBe('VIDEODATA'.length + '{"t":1}\n'.length + 'JPG'.length); // video + chat + thumb
  expect(rec.ended_at).not.toBeNull();
  expect(fs.existsSync(path.join(absDir, 'part-001.ts'))).toBe(false);
  expect(fs.existsSync(path.join(absDir, 'parts.txt'))).toBe(false);
  expect(fs.existsSync(path.join(absDir, 'meta.json'))).toBe(true);
  const concat = calls.find(c => c.cmd === 'ffmpeg' && c.args.includes('concat'))!;
  expect(concat.args).toContain('+faststart');
  const thumb = calls.find(c => c.cmd === 'ffmpeg' && c.args.includes('-frames:v'))!;
  expect(thumb.args[thumb.args.indexOf('-ss') + 1]).toBe('30'); // min(30, 4520/2)
});

test('thumbnail seek is 0 for very short recordings, thumb failure non-fatal', async () => {
  fs.writeFileSync(path.join(absDir, 'part-001.ts'), 'A');
  const exec: ExecFn = async (cmd, args, opts) => {
    calls.push({ cmd, args });
    const cwd = (opts as { cwd: string }).cwd;
    if (cmd === 'ffmpeg' && args.includes('concat')) fs.writeFileSync(path.join(cwd, 'video.mp4'), 'V');
    if (cmd === 'ffprobe') return '12\n';
    if (cmd === 'ffmpeg' && args.includes('-frames:v')) throw new Error('no keyframe');
    return '';
  };
  await finalizeRecording(db, recId, absDir, exec);
  expect(getRecording(db, recId)!.status).toBe('ready');
  const thumb = calls.find(c => c.cmd === 'ffmpeg' && c.args.includes('-frames:v'))!;
  expect(thumb.args[thumb.args.indexOf('-ss') + 1]).toBe('6'); // floor(12/2)
});

test('throws when no parts exist', async () => {
  await expect(finalizeRecording(db, recId, absDir, fakeExec)).rejects.toThrow(/no part files/i);
});

test('salvageOnStartup finalizes orphaned recordings and fails empty ones', async () => {
  fs.writeFileSync(path.join(absDir, 'part-001.ts'), 'AAAA');
  const rec2 = insertRecording(db, { streamer_login: 'x', started_at: 'now', title: '', game: '', dir_path: 'recordings/x/empty' });
  fs.mkdirSync(path.join(dataDir, 'recordings/x/empty'), { recursive: true });
  const rec3 = insertRecording(db, { streamer_login: 'x', started_at: 'now', title: '', game: '', dir_path: 'recordings/x/ok' });
  updateRecording(db, rec3, { status: 'ready' });
  await salvageOnStartup(db, dataDir, fakeExec);
  expect(getRecording(db, recId)!.status).toBe('ready');   // salvaged
  expect(getRecording(db, rec2)!.status).toBe('failed');   // no parts
  expect(getRecording(db, rec3)!.status).toBe('ready');    // untouched
});

test('salvage recovers a finalizing recording whose parts were already cleaned', async () => {
  updateRecording(db, recId, { status: 'finalizing', ended_at: '2026-06-12T21:00:00Z' });
  fs.writeFileSync(path.join(absDir, 'video.mp4'), 'VID');
  await salvageOnStartup(db, dataDir, fakeExec);
  const rec = getRecording(db, recId)!;
  expect(rec.status).toBe('ready');
  expect(rec.duration_s).toBeCloseTo(4520.25);
  expect(calls.some(c => c.cmd === 'ffmpeg' && c.args.includes('concat'))).toBe(false); // no re-concat
});

test('parts concat in numeric order past 999', async () => {
  for (const n of ['998', '999', '1000', '1001']) fs.writeFileSync(path.join(absDir, `part-${n}.ts`), 'X');
  let concatList = '';
  const exec: ExecFn = async (cmd, args, opts) => {
    calls.push({ cmd, args });
    const cwd = (opts as { cwd: string }).cwd;
    if (cmd === 'ffmpeg' && args.includes('concat')) {
      concatList = fs.readFileSync(path.join(cwd, 'parts.txt'), 'utf8');
      fs.writeFileSync(path.join(cwd, 'video.mp4'), 'V');
    }
    if (cmd === 'ffprobe') return '10\n';
    return '';
  };
  await finalizeRecording(db, recId, absDir, exec);
  expect(concatList).toBe("file 'part-998.ts'\nfile 'part-999.ts'\nfile 'part-1000.ts'\nfile 'part-1001.ts'\n");
});
