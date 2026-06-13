import { expect, test } from 'vitest';
import { QUALITY_PRESETS, presetLabel } from './quality';

test('QUALITY_PRESETS lists the four presets in order', () => {
  expect(QUALITY_PRESETS.map(p => p.label)).toEqual(['Source', '720p', '480p', 'Audio only']);
  expect(QUALITY_PRESETS.map(p => p.value)).toEqual(['best', '720p60,720p,480p,360p', '480p,360p,160p', 'audio_only']);
});

test('presetLabel maps stored values back to labels', () => {
  expect(presetLabel('best')).toBe('Source');
  expect(presetLabel('720p60,720p,480p,360p')).toBe('720p');
  expect(presetLabel('480p,360p,160p')).toBe('480p');
  expect(presetLabel('audio_only')).toBe('Audio only');
});

test('presetLabel returns Custom for an unrecognized value', () => {
  expect(presetLabel('1080p60')).toBe('Custom');
  expect(presetLabel('')).toBe('Custom');
});
