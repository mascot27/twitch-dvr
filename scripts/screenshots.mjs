// Generates the README screenshots from the REAL built UI with crafted DEMO data
// injected at the network layer (mocked API + a stubbed SSE EventSource + a real
// video frame as the /media fixture). It does NOT touch your real database.
//
// Regenerate:
//   npm run build
//   npm i -D playwright && npx playwright install chromium
//   # provide a video fixture at /tmp/ss-fixtures/{video.mp4,thumb.jpg} (any short clip)
//   node scripts/screenshots.mjs
//
// Output: assets/{dashboard,library,player,settings}.png
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'web', 'dist');
const FIX = '/tmp/ss-fixtures';
const OUT = path.join(ROOT, 'assets');
const PORT = 8456;
fs.mkdirSync(OUT, { recursive: true });

const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString();
const av = (ch, bg) => 'data:image/svg+xml;utf8,' + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="70" height="70"><rect width="70" height="70" rx="35" fill="${bg}"/><text x="35" y="47" font-size="32" fill="#fff" text-anchor="middle" font-family="Helvetica,Arial,sans-serif" font-weight="bold">${ch}</text></svg>`);

const STREAMERS = [
  { login: 'streamertwo', displayName: 'streamertwo', avatarUrl: av('i', '#a970ff'), autoRecord: true, quality: 'best',
    lastLiveAt: null, live: true, title: 'ranked grind to challenger — !sens !config', game: 'League of Legends',
    viewers: 3120, startedAt: iso(2 * 3600e3 + 14 * 60e3), recording: true },
  { login: 'streamerone', displayName: 'Streamerone', avatarUrl: av('S', '#1f8fff'), autoRecord: true, quality: '720p60,720p,480p,360p',
    lastLiveAt: null, live: true, title: 'cozy variety night — chatting then a bit of Valorant', game: 'Just Chatting',
    viewers: 842, startedAt: iso(38 * 60e3), recording: true },
  { login: 'pixelpunk', displayName: 'PixelPunk', avatarUrl: av('P', '#00b894'), autoRecord: true, quality: '480p,360p,160p',
    lastLiveAt: iso(26 * 3600e3), live: false, title: null, game: null, viewers: null, startedAt: null, recording: false },
  { login: 'nordicfox', displayName: 'NordicFox', avatarUrl: av('N', '#e056fd'), autoRecord: false, quality: 'best',
    lastLiveAt: iso(3 * 24 * 3600e3), live: false, title: null, game: null, viewers: null, startedAt: null, recording: false },
];

const REC = [
  { id: 1, streamerLogin: 'streamertwo', startedAt: iso(2 * 3600e3), endedAt: iso(0), title: 'ranked grind to challenger', game: 'League of Legends',
    status: 'ready', sizeBytes: 4.21e9, durationS: 7340, pinned: true, watchedAt: null, resumePositionS: 0, chatOffsetMs: 0,
    videoUrl: '/media/r1/video.mp4', thumbUrl: '/media/r1/thumb.jpg' },
  { id: 2, streamerLogin: 'streamerone', startedAt: iso(22 * 3600e3), endedAt: iso(19 * 3600e3), title: 'cozy variety night ☕', game: 'Just Chatting',
    status: 'ready', sizeBytes: 2.13e9, durationS: 10840, pinned: false, watchedAt: null, resumePositionS: 0, chatOffsetMs: 0,
    videoUrl: '/media/r2/video.mp4', thumbUrl: '/media/r2/thumb.jpg' },
  { id: 3, streamerLogin: 'pixelpunk', startedAt: iso(26 * 3600e3), endedAt: iso(24 * 3600e3), title: 'speedrun practice — any%', game: 'Celeste',
    status: 'ready', sizeBytes: 0.74e9, durationS: 5210, pinned: false, watchedAt: iso(20 * 3600e3), resumePositionS: 1830, chatOffsetMs: 0,
    videoUrl: '/media/r3/video.mp4', thumbUrl: '/media/r3/thumb.jpg' },
  { id: 4, streamerLogin: 'streamertwo', startedAt: iso(2 * 24 * 3600e3), endedAt: iso(2 * 24 * 3600e3 - 8200e3), title: 'scrim review + soloq', game: 'League of Legends',
    status: 'ready', sizeBytes: 5.02e9, durationS: 8200, pinned: false, watchedAt: iso(40 * 3600e3), resumePositionS: 0, chatOffsetMs: 0,
    videoUrl: '/media/r4/video.mp4', thumbUrl: '/media/r4/thumb.jpg' },
  { id: 5, streamerLogin: 'streamerone', startedAt: iso(3 * 24 * 3600e3), endedAt: iso(3 * 24 * 3600e3 - 6400e3), title: 'art stream — commissions', game: 'Art',
    status: 'ready', sizeBytes: 1.36e9, durationS: 6400, pinned: false, watchedAt: iso(60 * 3600e3), resumePositionS: 0, chatOffsetMs: 0,
    videoUrl: '/media/r5/video.mp4', thumbUrl: '/media/r5/thumb.jpg' },
  { id: 6, streamerLogin: 'nordicfox', startedAt: iso(5 * 24 * 3600e3), endedAt: iso(5 * 24 * 3600e3 - 3100e3), title: 'late night co-op', game: "Baldur's Gate 3",
    status: 'ready', sizeBytes: 0.93e9, durationS: 3100, pinned: false, watchedAt: iso(100 * 3600e3), resumePositionS: 0, chatOffsetMs: 0,
    videoUrl: '/media/r6/video.mp4', thumbUrl: '/media/r6/thumb.jpg' },
];

// emote ids resolve from Twitch's public CDN (static-cdn.jtvnw.net): 25=Kappa, 425618=LUL, 88=PogChamp
const E = (id, s, e) => ({ id, s, e });
const CHAT = [
  { t: 72000, type: 'msg', id: 'a1', user: 'mikteh', display: 'mikteh', color: '#ff7f50', badges: ['subscriber/12'], text: 'this teamfight is insane', emotes: [] },
  { t: 74000, type: 'msg', id: 'a2', user: 'lunalux', display: 'LunaLux', color: '#1f8fff', badges: ['vip/1'], text: 'KEKW he flashed into the wall', emotes: [] },
  { t: 76500, type: 'msg', id: 'a3', user: 'modbot', display: 'ModBot', color: '#00b894', badges: ['moderator/1'], text: 'remember to !vote for the next game', emotes: [] },
  { t: 78000, type: 'msg', id: 'a4', user: 'sparky', display: 'Sparky', color: '#e056fd', badges: [], text: 'LUL LUL', emotes: [E('425618', 0, 2), E('425618', 4, 6)] },
  { t: 80000, type: 'msg', id: 'del-1', user: 'free_primes_xyz', display: 'free_primes_xyz', color: '#888', badges: [], text: 'FREE prime sub generator → bit ly / claim', emotes: [] },
  { t: 81500, type: 'msg', id: 'a5', user: 'kappaking', display: 'KappaKing', color: '#9147ff', badges: ['subscriber/3'], text: 'Kappa not this guy again', emotes: [E('25', 0, 4)] },
  { t: 83000, type: 'msg', id: 'a6', user: 'angryviewer', display: 'angryViewer', color: '#eb0400', badges: [], text: 'this caster is so biased honestly', emotes: [] },
  { t: 84500, type: 'msg', id: 'a7', user: 'angryviewer', display: 'angryViewer', color: '#eb0400', badges: [], text: 'mods doing nothing as always', emotes: [] },
  { t: 86000, type: 'msg', id: 'a8', user: 'pogentine', display: 'Pogentine', color: '#00b5cc', badges: ['subscriber/24'], text: 'PogChamp THE OUTPLAY', emotes: [E('88', 0, 8)] },
  { t: 87000, type: 'system', text: 'Pogentine subscribed for 24 months — let’s gooo' },
  { t: 88200, type: 'msg', id: 'a9', user: 'mikteh', display: 'mikteh', color: '#ff7f50', badges: ['subscriber/12'], text: 'GG that was clean', emotes: [] },
  { t: 89500, type: 'msg', id: 'a10', user: 'novaaa', display: 'novaaa', color: '#ffca5f', badges: [], text: 'what sensitivity does he use? !sens', emotes: [] },
  { t: 90600, type: 'msg', id: 'a11', user: 'lunalux', display: 'LunaLux', color: '#1f8fff', badges: ['vip/1'], text: 'clip it!!', emotes: [] },
  { t: 91500, type: 'msg', id: 'a12', user: 'sparky', display: 'Sparky', color: '#e056fd', badges: [], text: 'challenger arc loading', emotes: [] },
];
const DELS = [
  { t: 80500, kind: 'message', user: 'free_primes_xyz', targetId: 'del-1' }, // single-message delete (spam)
  { t: 85500, kind: 'user', user: 'angryviewer', durationS: 600 },           // 10-min timeout clears their msgs
];

const DISK = { usedBytes: 71.4e9, capBytes: 100e9, freeBytes: 312e9 };
const SETTINGS = { diskCapGb: 100, pollIntervalS: 60, dataDir: '~/TwitchDVR' };

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.ico': 'image/x-icon' };
const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url.startsWith('/media/')) {
    const isMp4 = url.endsWith('.mp4');
    // map /media/r<id>/thumb.jpg → a per-id thumbnail variant so the grid looks varied
    const idm = /\/r(\d+)\//.exec(url);
    const thumb = idm && fs.existsSync(path.join(FIX, `thumb${idm[1]}.jpg`)) ? `thumb${idm[1]}.jpg` : 'thumb.jpg';
    const f = isMp4 ? path.join(FIX, 'video.mp4') : path.join(FIX, thumb);
    if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
    const type = isMp4 ? 'video/mp4' : 'image/jpeg';
    const size = fs.statSync(f).size;
    const range = isMp4 && req.headers.range && /bytes=(\d+)-(\d*)/.exec(req.headers.range);
    if (range) {
      const start = parseInt(range[1], 10);
      const end = range[2] ? parseInt(range[2], 10) : size - 1;
      res.writeHead(206, { 'content-type': type, 'accept-ranges': 'bytes', 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': end - start + 1 });
      return fs.createReadStream(f, { start, end }).pipe(res);
    }
    res.writeHead(200, { 'content-type': type, 'accept-ranges': 'bytes', 'content-length': size });
    return fs.createReadStream(f).pipe(res);
  }
  let f = path.join(DIST, url === '/' ? 'index.html' : url.replace(/^\//, ''));
  // containment: a crafted ../ path must never resolve outside the built dashboard dir
  if (!path.resolve(f).startsWith(DIST + path.sep)) f = path.join(DIST, 'index.html');
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(DIST, 'index.html'); // SPA fallback
  res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});

await new Promise(r => server.listen(PORT, r));
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1320, height: 880 }, deviceScaleFactor: 2, colorScheme: 'dark' });
const page = await ctx.newPage();

await page.addInitScript((streamers) => {
  class FakeES {
    constructor() { this.listeners = {}; setTimeout(() => { this.readyState = 1; if (this.onopen) this.onopen({}); this._emit('status', JSON.stringify({ streamers, stale: false })); }, 30); }
    addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); }
    removeEventListener() {}
    _emit(t, data) { const ev = { data }; if (t === 'message' && this.onmessage) this.onmessage(ev); (this.listeners[t] || []).forEach(f => f(ev)); }
    close() {}
  }
  // @ts-ignore
  window.EventSource = FakeES;
}, STREAMERS);

await page.route('**/api/**', route => {
  const p = new URL(route.request().url()).pathname;
  const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
  if (p === '/api/recordings') return json(REC);
  if (/^\/api\/recordings\/\d+\/chat$/.test(p)) return json(CHAT);
  if (/^\/api\/recordings\/\d+\/deletions$/.test(p)) return json(DELS);
  if (/^\/api\/recordings\/\d+$/.test(p)) return json(REC[0]);
  if (p === '/api/disk') return json(DISK);
  if (p === '/api/settings') return json(SETTINGS);
  if (p === '/api/streamers') return json({ streamers: STREAMERS, stale: false });
  return json({});
});

const shot = async (route, name, after) => {
  await page.goto(`http://localhost:${PORT}${route}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  if (after) await after();
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, name) });
  console.log('captured', name);
};

await shot('/', 'dashboard.png');
await shot('/library', 'library.png');
await shot('/watch/1', 'player.png', async () => {
  // wait for the video to have metadata so the seek actually takes, then seek —
  // the seek fires 'timeupdate', which drives the chat replay to t=92s
  await page.waitForFunction(() => { const v = document.querySelector('video'); return !!v && v.readyState >= 1; }, { timeout: 8000 }).catch(() => {});
  await page.evaluate(() => { const v = document.querySelector('video'); if (v) { v.muted = true; v.currentTime = 92; v.dispatchEvent(new Event('timeupdate')); } });
  await page.waitForFunction(() => { const v = document.querySelector('video'); return !!v && Math.abs(v.currentTime - 92) < 6; }, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(1600); // let chat windows load + emote/badge images fetch
  // pause + hide the native control bar for a clean product shot (its short fixture
  // duration would otherwise contradict the recording's real length in the header)
  await page.evaluate(() => { const v = document.querySelector('video'); if (v) { v.pause(); v.removeAttribute('controls'); } });
  await page.waitForTimeout(300);
});
await shot('/settings', 'settings.png');

await browser.close();
server.close();
console.log('done');
