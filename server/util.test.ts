import { describe, expect, test } from 'vitest';
import { expandTilde, slugify, timestampForDir } from './util.js';
import os from 'node:os';

describe('slugify', () => {
  test('lowercases and dashes non-alphanumerics', () => {
    expect(slugify('My COOL Stream! [Day 4]')).toBe('my-cool-stream-day-4');
  });
  test('strips accents, collapses dashes, trims edges', () => {
    expect(slugify('  Été à Paris -- GO  ')).toBe('ete-a-paris-go');
  });
  test('caps at 60 chars', () => {
    expect(slugify('x'.repeat(100)).length).toBe(60);
  });
  test('falls back to stream for emoji-only/empty titles', () => {
    expect(slugify('🎉🎉🎉')).toBe('stream');
    expect(slugify('')).toBe('stream');
  });
});

describe('expandTilde', () => {
  test('expands ~ to home', () => {
    expect(expandTilde('~/TwitchDVR')).toBe(`${os.homedir()}/TwitchDVR`);
  });
  test('leaves absolute paths alone', () => {
    expect(expandTilde('/tmp/x')).toBe('/tmp/x');
  });
});

describe('timestampForDir', () => {
  test('formats local date as YYYY-MM-DD_HHmm', () => {
    expect(timestampForDir(new Date(2026, 5, 12, 20, 5))).toBe('2026-06-12_2005');
  });
});
