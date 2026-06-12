import type { StreamStatus } from './types.js';

// Unofficial endpoint used by the Twitch web player. Public Client-ID, no secret.
// If Twitch ever changes this, ONLY this file should need to change.
export const GQL_URL = 'https://gql.twitch.tv/gql';
export const CLIENT_ID = 'kd1unb4b3q4t58fwlpcbzcbnm76a8fp';

const STATUS_QUERY = `query($login: String!) {
  user(login: $login) {
    login displayName profileImageURL(width: 70)
    stream { id title viewersCount createdAt game { displayName } }
  }
}`;

const RESERVED = new Set(['videos', 'directory', 'clip', 'clips', 'p', 'settings', 'search', 'downloads', 'kraken', 'subscriptions', 'wallet', 'drops', 'friends', 'jobs', 'turbo']);

export function parseLoginFromInput(input: string): string | null {
  let s = input.trim().toLowerCase();
  const isUrl = s.includes('twitch.tv');
  if (isUrl) {
    s = s.slice(s.indexOf('twitch.tv') + 'twitch.tv'.length);
    s = s.replace(/^\//, '').split(/[/?#]/)[0] ?? '';
    if (RESERVED.has(s)) return null;
  }
  return /^[a-z0-9_]{2,25}$/.test(s) ? s : null;
}

export function buildStatusBody(logins: string[]): { query: string; variables: { login: string } }[] {
  return logins.map(login => ({ query: STATUS_QUERY, variables: { login } }));
}

// Returns the raw user object for the i-th batched operation, or null.
// Throws when the entry carries GQL errors with no data — callers must treat
// that as a failed poll, NOT as "user offline/doesn't exist" (load-bearing for
// the watcher's offline debounce).
export function extractUser(json: unknown, i: number): any | null {
  const arr = Array.isArray(json) ? json : [];
  const entry = arr[i] as any;
  if (entry && entry.errors && !entry.data) throw new Error(`gql error: ${JSON.stringify(entry.errors).slice(0, 200)}`);
  return entry?.data?.user ?? null;
}

export function parseStatusResponse(logins: string[], json: unknown): StreamStatus[] {
  return logins.map((login, i) => {
    const u = extractUser(json, i);
    if (!u) {
      return { login, displayName: login, avatarUrl: '', live: false, title: null, game: null, viewers: null, startedAt: null };
    }
    const st = u.stream;
    return {
      login,
      displayName: u.displayName ?? login,
      avatarUrl: u.profileImageURL ?? '',
      live: Boolean(st),
      title: st?.title ?? null,
      game: st?.game?.displayName ?? null,
      viewers: st?.viewersCount ?? null,
      startedAt: st?.createdAt ?? null,
    };
  });
}

async function gqlPost(body: unknown): Promise<unknown> {
  const res = await fetch(GQL_URL, {
    method: 'POST',
    headers: { 'Client-ID': CLIENT_ID, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`gql http ${res.status}`);
  return res.json();
}

export async function fetchStatuses(logins: string[]): Promise<StreamStatus[]> {
  if (!logins.length) return [];
  return parseStatusResponse(logins, await gqlPost(buildStatusBody(logins)));
}

export async function resolveUser(login: string): Promise<{ login: string; displayName: string; avatarUrl: string } | null> {
  const json = await gqlPost(buildStatusBody([login]));
  const u = extractUser(json, 0);
  if (!u) return null;
  return { login: u.login ?? login, displayName: u.displayName ?? login, avatarUrl: u.profileImageURL ?? '' };
}
