export interface QualityPreset { label: string; value: string }

// Fallback chains step DOWN only — a missing rendition picks a lower one,
// never jumping back up to source (which would defeat the disk saving).
export const QUALITY_PRESETS: QualityPreset[] = [
  { label: 'Source', value: 'best' },
  { label: '720p', value: '720p60,720p,480p,360p' },
  { label: '480p', value: '480p,360p,160p' },
  { label: 'Audio only', value: 'audio_only' },
];

export function presetLabel(stored: string): string {
  return QUALITY_PRESETS.find(p => p.value === stored)?.label ?? 'Custom';
}
