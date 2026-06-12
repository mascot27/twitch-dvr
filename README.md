# Twitch DVR

Self-hosted dashboard that tracks Twitch streamers, notifies when they go live,
auto-records their streams (video + chat, no Twitch credentials needed), and
replays recordings with synced chat.

## Requirements

- macOS, Node 22+
- `brew install streamlink ffmpeg`

## Setup

```bash
npm install
npm run build          # build the web UI
npm start              # dashboard at http://localhost:8454
```

Add streamers by name or URL on the dashboard. Recordings land in `~/TwitchDVR`
(change in `config.json`). Disk cap and poll interval are in Settings.

## Run at login (recommended)

```bash
npm run service:install    # launchd agent: starts at login, restarts on crash
npm run service:uninstall
```

Logs: `~/TwitchDVR/logs/`. Keep the Mac awake (recording holds a caffeinate
assertion, but a sleeping Mac can't notice a stream starting).

## Dev

```bash
npm run dev:server   # api on :8454
npm run dev:web      # vite dev server on :5173 (proxies /api and /media)
npm test
```

## Notes

- Uses Twitch's unofficial GQL endpoint and anonymous chat — zero credentials,
  but it can break if Twitch changes things. Fixes live in `server/twitchGql.ts`.
- Keep streamlink fresh: `brew upgrade streamlink` if recordings start failing.
```
