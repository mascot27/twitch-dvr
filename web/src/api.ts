export interface StreamerView {
  login: string; displayName: string; avatarUrl: string;
  autoRecord: boolean; quality: string; lastLiveAt: string | null;
  live: boolean; title: string | null; game: string | null;
  viewers: number | null; startedAt: string | null; recording: boolean;
}
export interface RecordingView {
  id: number; streamerLogin: string; startedAt: string; endedAt: string | null;
  title: string; game: string; status: 'recording' | 'finalizing' | 'ready' | 'failed';
  sizeBytes: number; durationS: number; pinned: boolean; watchedAt: string | null;
  resumePositionS: number; chatOffsetMs: number; videoUrl: string; thumbUrl: string;
}
export interface ChatEmote { id: string; s: number; e: number }
export interface ChatLine {
  t: number; type: 'msg' | 'system';
  user?: string; display?: string; color?: string; badges?: string[];
  text: string; emotes?: ChatEmote[];
}
export interface SettingsView { diskCapGb: number; pollIntervalS: number; dataDir: string }
export interface DiskView { usedBytes: number; capBytes: number; freeBytes: number }

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init?.body
    ? { ...init, headers: { 'content-type': 'application/json', ...init.headers } }
    : init);
  if (!res.ok) {
    let msg = `${res.status}`;
    try { msg = ((await res.json()) as { error?: string }).error ?? msg; } catch { /* keep status */ }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

export const api = {
  streamers: () => req<{ streamers: StreamerView[]; stale: boolean }>('/api/streamers'),
  addStreamer: (nameOrUrl: string) => req<{ login: string }>('/api/streamers', { method: 'POST', body: JSON.stringify({ nameOrUrl }) }),
  patchStreamer: (login: string, p: { autoRecord?: boolean; quality?: string }) =>
    req(`/api/streamers/${login}`, { method: 'PATCH', body: JSON.stringify(p) }),
  deleteStreamer: (login: string) => req(`/api/streamers/${login}`, { method: 'DELETE' }),
  recordStart: (login: string) => req(`/api/streamers/${login}/record/start`, { method: 'POST' }),
  recordStop: (login: string) => req(`/api/streamers/${login}/record/stop`, { method: 'POST' }),
  recordings: (streamer?: string) => req<RecordingView[]>(`/api/recordings${streamer ? `?streamer=${encodeURIComponent(streamer)}` : ''}`),
  recording: (id: number) => req<RecordingView>(`/api/recordings/${id}`),
  patchRecording: (id: number, p: { pinned?: boolean; watchedAt?: string; resumePositionS?: number; chatOffsetMs?: number }) =>
    req(`/api/recordings/${id}`, { method: 'PATCH', body: JSON.stringify(p) }),
  deleteRecording: (id: number) => req(`/api/recordings/${id}`, { method: 'DELETE' }),
  chat: (id: number, fromMs: number, toMs: number) => req<ChatLine[]>(`/api/recordings/${id}/chat?fromMs=${fromMs}&toMs=${toMs}`),
  settings: () => req<SettingsView>('/api/settings'),
  patchSettings: (p: { diskCapGb?: number; pollIntervalS?: number }) => req('/api/settings', { method: 'PATCH', body: JSON.stringify(p) }),
  disk: () => req<DiskView>('/api/disk'),
};
