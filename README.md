# 📼 Twitch DVR

A small self-hosted dashboard for your Mac that watches a list of Twitch
streamers, tells you when they go live, and **automatically records their
streams — video *and* chat** — so you can browse and watch them later with the
chat replayed in sync.

No Twitch account, API keys, or credentials required.

---

## What it does

- **Track streamers** — add channels by name or URL (`twitch.tv/streamertwo`, `streamerone`, …) and see live/offline status update in real time.
- **Go-live notifications** — native macOS banners and browser notifications the moment a tracked streamer starts.
- **Automatic recording** — when a streamer goes live, their stream is recorded in the background. Several streamers live at once? Each is recorded independently and concurrently.
- **Chat is recorded too** — every message (with names, colors, badges and emotes) is saved alongside the video.
- **Browse & replay** — a library of past recordings with thumbnails; the player shows the video next to a chat panel that scrolls in sync, with a nudge control to fine-tune timing.
- **Self-managing disk** — set a size cap and the oldest unwatched recordings are pruned automatically. Pin the ones you want to keep forever.
- **Survives crashes & reboots** — a recording interrupted by a crash is salvaged into a playable file on the next start.

Watching the *live* stream happens on Twitch itself — each live card links straight to `twitch.tv`. Twitch DVR is about catching and re-watching streams, not replacing the live player.

---

## Requirements

- **macOS** (uses native notifications, `caffeinate`, and a launchd service)
- **[Node.js](https://nodejs.org) 22 or newer**
- **streamlink** and **ffmpeg**, via [Homebrew](https://brew.sh):

  ```bash
  brew install streamlink ffmpeg
  ```

---

## Quick start

```bash
npm install        # install dependencies
npm run build      # build the web dashboard
npm start          # start the server
```

Then open **<http://localhost:8454>** and add a streamer.

That's it — leave it running and it will record tracked streamers as they go
live. (For an always-on setup that starts automatically, see
[Run at login](#run-at-login).)

---

## Using it

**Dashboard** (`/`) — your streamers as cards.
- Add a channel with the box at the top (name or full URL).
- Live cards show the title, game, uptime and viewer count, a link to watch on Twitch, and a red **REC** dot while recording.
- Toggle **auto-record** per streamer, or hit **Record now** / **Stop recording** manually.
- **Remove** a streamer at any time — your recordings of them are kept.

**Library** (`/library`) — every recording as a thumbnail tile.
- Filter by streamer; see date, duration and size.
- A bar shows disk usage against your cap.
- ★ **pin** a recording so auto-cleanup never deletes it; an unwatched dot marks ones you haven't opened.

**Player** (`/watch/:id`) — video with synced chat replay.
- Native video controls with seeking; playback position is remembered so you can resume later.
- The chat panel replays messages in time with the video, rendering Twitch emotes and badges.
- Messages a moderator deleted — single deletes, and messages cleared by a timeout or ban — stay visible but are highlighted in red with a strikethrough and a "deleted" tag, so you can see what was removed. (Applies to recordings made after this feature shipped.)
- Use the **±1s / ±5s** buttons if chat drifts ahead of or behind the video — the offset is saved per recording.

**Settings** (`/settings`) — disk cap (GB), how often to poll Twitch, and a button to grant browser notification permission.

---

## Run at login

To have Twitch DVR start automatically when you log in and stay running (it
won't catch a stream while it isn't running):

```bash
npm run service:install     # installs a launchd agent (starts at login, restarts on crash)
npm run service:uninstall   # removes it
```

Once installed it runs in the background; just open <http://localhost:8454>
whenever you want the dashboard. Logs are written to `~/TwitchDVR/logs/`.

> **Keep your Mac awake.** While a recording is in progress the app holds a
> `caffeinate` assertion so the machine won't sleep mid-stream. But a Mac that's
> already asleep can't notice a stream *starting* — so for full coverage, set
> your Mac to not sleep (System Settings → Battery/Lock Screen), or keep it on
> while you expect streams.

---

## Where your data lives

Everything is stored under **`~/TwitchDVR`** (configurable — see below), so it's
self-contained and easy to back up or move:

```
~/TwitchDVR/
├── twitch-dvr.db                     SQLite index of streamers & recordings
├── logs/                             server logs (when run as a service)
└── recordings/
    └── <streamer>/
        └── 2026-06-12_2030_<title>/
            ├── video.mp4             the recording (seekable, faststart)
            ├── chat.jsonl            chat log, one message per line
            ├── thumb.jpg             thumbnail
            └── meta.json             title, game, timestamps, duration
```

Each recording folder is standalone — the `.mp4` plays in any player, and the
chat sits right next to it.

---

## Configuration

Two things are set in **`config.json`** (created in the project folder on first
run). Changing them requires a restart:

```json
{
  "port": 8454,
  "dataDir": "~/TwitchDVR"
}
```

Everything else is live-editable in the **Settings** page and stored in the
database:

| Setting | Default | Notes |
|---|---|---|
| Disk cap | 100 GB | Oldest unpinned recordings are deleted once usage exceeds this. |
| Poll interval | 60 s | How often live status is checked (minimum 30 s). |

Recordings stop automatically if free disk space drops below 10 GB, and you'll
get a notification.

> Recordings are captured at **best available quality** by default. The quality
> string is configurable per-streamer through the API
> (`PATCH /api/streamers/:login`) if you want to cap it.

---

## Development

```bash
npm run dev:server   # API + watcher with hot reload (http://localhost:8454)
npm run dev:web      # Vite dev server (http://localhost:5173, proxies to the API)
npm test             # run the test suite (Vitest)
npm run typecheck    # type-check server and web
```

For local development, run **both** `dev:server` and `dev:web` and use the Vite
URL (`:5173`) — it proxies `/api` and `/media` to the server and gives you
instant frontend reloads. In production, `npm run build` + `npm start` serves
the built dashboard directly from the API on `:8454`.

### Verify the recording pipeline end-to-end

Record a few seconds of any live channel through the real pipeline (streamlink →
ffmpeg → chat) into a temp folder:

```bash
npm run smoke -- <channel> [seconds]   # e.g. npm run smoke -- examplechannel 30
```

It prints the resulting files and chat line count, and exits non-zero if the
recording didn't come out playable.

---

## How it works

A single Node process ties together a handful of focused pieces:

- **Watcher** polls Twitch's status for all tracked streamers and emits live/offline transitions (with a short debounce so brief blips don't end a recording).
- **Recorder** spawns `streamlink` per live streamer, writing segment files that `ffmpeg` concatenates into a seekable MP4 when the stream ends.
- **Chat logger** joins each channel anonymously over Twitch IRC and appends messages to `chat.jsonl`.
- **Cleanup** enforces the disk cap, oldest-first, never touching pinned recordings.
- **API + dashboard** — a Fastify server exposes a REST + Server-Sent-Events API and serves the React dashboard; the player streams video with HTTP range requests and pages chat in windows.

The whole architecture and the design decisions behind it are written up in
[`docs/superpowers/specs/`](docs/superpowers/specs/), with the implementation
plan in [`docs/superpowers/plans/`](docs/superpowers/plans/).

---

## Troubleshooting

**Status stops updating / "showing last known state" banner.**
Twitch DVR uses Twitch's *unofficial* web endpoints (the same ones the website
uses) so it needs no credentials — but that means Twitch can change them. If
status checks start failing, it's usually that; the fix is isolated to
[`server/twitchGql.ts`](server/twitchGql.ts).

**Recordings suddenly fail to start.**
Twitch periodically changes how streams/ads are delivered. Update streamlink:

```bash
brew upgrade streamlink
```

**A stream wasn't recorded.**
The app can only record while it's running, and can't notice a stream that
starts while the Mac is asleep. Use [Run at login](#run-at-login) and keep the
Mac awake for full coverage.

**Nothing happens when I add a streamer.**
Make sure you ran `npm run build` before `npm start` — without the built
dashboard the server still runs as a headless API, but there's no UI to load.

---

## Notes & limitations

- **Personal, single-user tool.** The server binds to `127.0.0.1` (localhost only) and has no authentication by design — don't expose it to the internet.
- **macOS only** for now (native notifications, `caffeinate`, launchd).
- **Live viewing** is a click-through to Twitch, not an embedded player.
- Third-party emotes (7TV/BTTV/FFZ) aren't rendered — Twitch's own emotes are.
