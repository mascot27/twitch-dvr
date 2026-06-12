import { expect, test } from 'vitest';
import { badgeUrl, segmentMessage } from './emotes';

test('segmentMessage splits text around emote ranges (code points)', () => {
  // "LUL hi LUL" with LUL at 0-2 and 7-9
  const segs = segmentMessage('LUL hi LUL', [{ id: '425618', s: 0, e: 2 }, { id: '425618', s: 7, e: 9 }]);
  expect(segs).toEqual([
    { kind: 'emote', id: '425618', alt: 'LUL' },
    { kind: 'text', text: ' hi ' },
    { kind: 'emote', id: '425618', alt: 'LUL' },
  ]);
});

test('segmentMessage counts astral emoji as one code point (twitch indexing)', () => {
  // "🎉 Kappa" — emoji is 1 code point, so Kappa spans 2-6
  const segs = segmentMessage('🎉 Kappa', [{ id: '25', s: 2, e: 6 }]);
  expect(segs).toEqual([
    { kind: 'text', text: '🎉 ' },
    { kind: 'emote', id: '25', alt: 'Kappa' },
  ]);
});

test('segmentMessage with no emotes returns single text segment', () => {
  expect(segmentMessage('hello', [])).toEqual([{ kind: 'text', text: 'hello' }]);
});

test('segmentMessage ignores out-of-range emotes', () => {
  expect(segmentMessage('hi', [{ id: '1', s: 5, e: 9 }])).toEqual([{ kind: 'text', text: 'hi' }]);
});

test('badgeUrl maps known badges, null for unknown', () => {
  expect(badgeUrl('moderator/1')).toContain('static-cdn.jtvnw.net/badges/v1/');
  expect(badgeUrl('subscriber/42')).toContain('static-cdn.jtvnw.net');
  expect(badgeUrl('weird-badge/3')).toBeNull();
});
