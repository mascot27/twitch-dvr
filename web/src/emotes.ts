import type { ChatEmote } from './api';

export type Segment = { kind: 'text'; text: string } | { kind: 'emote'; id: string; alt: string };

export function emoteUrl(id: string): string {
  return `https://static-cdn.jtvnw.net/emoticons/v2/${encodeURIComponent(id)}/default/dark/1.0`;
}

// Twitch emote indices count unicode CODE POINTS, not UTF-16 units.
export function segmentMessage(text: string, emotes: ChatEmote[]): Segment[] {
  const cps = Array.from(text);
  const segs: Segment[] = [];
  let pos = 0;
  const valid = emotes.filter(e => e.s >= 0 && e.e < cps.length && e.s <= e.e).sort((a, b) => a.s - b.s);
  for (const e of valid) {
    if (e.s < pos) continue; // overlapping/duplicate range
    if (e.s > pos) segs.push({ kind: 'text', text: cps.slice(pos, e.s).join('') });
    segs.push({ kind: 'emote', id: e.id, alt: cps.slice(e.s, e.e + 1).join('') });
    pos = e.e + 1;
  }
  if (pos < cps.length) segs.push({ kind: 'text', text: cps.slice(pos).join('') });
  return segs.length ? segs : [{ kind: 'text', text: '' }];
}

// Known global badge set UUIDs (stable for years). Channel-custom sub badges
// fall back to the generic subscriber star. Unknown badges render nothing.
const BADGE_IDS: Record<string, string> = {
  broadcaster: '5527c58c-fb7d-422d-b71b-f309dcb85cc1',
  moderator: '3267646d-33f0-4b17-b3df-f923a41db1d0',
  vip: 'b817aba4-fad8-49e2-b88a-7cc744dfa6ec',
  partner: 'd12a2e27-16f6-41d0-ab77-b780518f00a3',
  subscriber: '5d9f2208-5dd8-11e7-8513-2ff4adfae661',
};

export function badgeUrl(badge: string): string | null {
  const set = badge.split('/')[0];
  const id = BADGE_IDS[set];
  return id ? `https://static-cdn.jtvnw.net/badges/v1/${id}/1` : null;
}
