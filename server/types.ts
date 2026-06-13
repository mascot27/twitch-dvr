export interface StreamStatus {
  login: string;
  displayName: string;
  avatarUrl: string;
  live: boolean;
  title: string | null;
  game: string | null;
  viewers: number | null;
  startedAt: string | null; // ISO
}

export interface StreamerRow {
  login: string;
  display_name: string;
  avatar_url: string;
  auto_record: number; // 0|1
  quality: string;
  added_at: string;
  last_live_at: string | null;
}

export type RecordingStatus = 'recording' | 'finalizing' | 'ready' | 'failed';

export interface RecordingRow {
  id: number;
  streamer_login: string;
  started_at: string;
  ended_at: string | null;
  title: string;
  game: string;
  status: RecordingStatus;
  dir_path: string; // relative to dataDir, e.g. recordings/streamerone/2026-06-12_2030_title
  size_bytes: number;
  duration_s: number;
  pinned: number; // 0|1
  watched_at: string | null;
  resume_position_s: number;
  chat_offset_ms: number;
}

// s/e: start/end offsets into ChatLine.text, counted in Unicode CODE POINTS
// (Twitch IRC emote indices), not UTF-16 units.
export interface ChatEmote { id: string; s: number; e: number }

export interface ChatLine {
  t: number; // ms since recording start
  type: 'msg' | 'system';
  id?: string;        // Twitch message id (msg lines made after the deletion feature shipped)
  user?: string;
  display?: string;
  color?: string;
  badges?: string[];
  text: string;
  emotes?: ChatEmote[];
}

export interface DeletionRecord {
  t: number;                 // ms since recording start
  kind: 'message' | 'user';
  user: string;              // CLEARMSG login / CLEARCHAT target (lowercase login)
  targetId?: string;         // CLEARMSG: id of the deleted message
  durationS?: number;        // CLEARCHAT timeout seconds; absent = permanent ban
}
