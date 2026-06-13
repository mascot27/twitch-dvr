import fs from 'node:fs';
import path from 'node:path';
import { expandTilde } from './util.js';

export interface AppConfig {
  port: number;
  dataDir: string; // absolute, ~ expanded
}

const DEFAULTS = { port: 8454, dataDir: '~/TwitchDVR' };

export function loadConfig(rootDir: string): AppConfig {
  const file = path.join(rootDir, 'config.json');
  // atomic create-if-absent ('wx' fails when the file exists) — avoids a
  // TOCTOU race between an existence check and the write
  try {
    fs.writeFileSync(file, JSON.stringify(DEFAULTS, null, 2) + '\n', { flag: 'wx' });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
  }
  const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<typeof DEFAULTS>;
  return {
    port: raw.port ?? DEFAULTS.port,
    dataDir: expandTilde(raw.dataDir ?? DEFAULTS.dataDir),
  };
}
