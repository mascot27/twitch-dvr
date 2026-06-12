import { afterEach, beforeEach, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from './config.js';

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dvr-cfg-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

test('creates config.json with defaults when missing', () => {
  const cfg = loadConfig(dir);
  expect(cfg.port).toBe(8454);
  expect(cfg.dataDir).toBe(path.join(os.homedir(), 'TwitchDVR'));
  const onDisk = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8'));
  expect(onDisk).toEqual({ port: 8454, dataDir: '~/TwitchDVR' });
});

test('reads existing config and expands ~', () => {
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ port: 9000, dataDir: '~/Movies/DVR' }));
  const cfg = loadConfig(dir);
  expect(cfg.port).toBe(9000);
  expect(cfg.dataDir).toBe(path.join(os.homedir(), 'Movies/DVR'));
});

test('fills missing fields with defaults', () => {
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify({ port: 9000 }));
  expect(loadConfig(dir).dataDir).toBe(path.join(os.homedir(), 'TwitchDVR'));
});
