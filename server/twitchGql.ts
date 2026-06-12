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

export function parseLoginFromInput(input: string): string | null {
  let s = input.trim().toLowerCase();
  if (s.includes('twitch.tv')) {
    s = s.slice(s.indexOf('twitch.tv') + 'twitch.tv'.length);
    s = s.replace(/^\//, '').split(/[/?#]/)[0] ?? '';
  }
  return /^[a-z0-9_]{2,25}$/.test(s) ? s : null;
}

export function buildStatusBody(logins: string[]): { query: string; variables: { login: string } }[] {
  return logins.map(login => ({ query: STATUS_QUERY, variables: { login } }));
}

export function parseStatusResponse(logins: string[], json: unknown): StreamStatus[] {
  const arr = Array.isArray(json) ? json : [];
  return logins.map((login, i) => {
    const u = (arr[i] as any)?.data?.user;
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
  });
  if (!res.ok) throw new Error(`gql http ${res.status}`);
  return res.json();
}

export async function fetchStatuses(logins: string[]): Promise<StreamStatus[]> {
  if (!logins.length) return [];
  return parseStatusResponse(logins, await gqlPost(buildStatusBody(logins)));
}

export async function resolveUser(login: string): Promise<{ login: string; displayName: string; avatarUrl: string } | null> {
  const json = (await gqlPost(buildStatusBody([login]))) as any[];
  const u = json?.[0]?.data?.user;
  if (!u) return null;
  return { login: u.login ?? login, displayName: u.displayName ?? login, avatarUrl: u.profileImageURL ?? '' };
}
