import type { Bus } from './events.js';
import { getSetting, listStreamers, touchLastLive, updateStreamerMeta, type Db } from './db.js';
import { nowIso } from './util.js';
import type { StreamStatus } from './types.js';

export interface WatcherDeps {
  db: Db;
  bus: Bus;
  fetchStatuses: (logins: string[]) => Promise<StreamStatus[]>;
}

export interface Watcher {
  tick(): Promise<void>;
  start(): void;
  stop(): void;
  getStatuses(): StreamStatus[];
  isConsideredLive(login: string): boolean;
  isStale(): boolean;
}

const STALE_AFTER_FAILURES = 5;
const OFFLINE_POLLS_REQUIRED = 2;

export function createWatcher({ db, bus, fetchStatuses }: WatcherDeps): Watcher {
  const consideredLive = new Map<string, boolean>();
  const offlineCount = new Map<string, number>();
  let lastStatuses: StreamStatus[] = [];
  let failCount = 0;
  let timer: NodeJS.Timeout | null = null;
  let ticking = false;

  async function tick(): Promise<void> {
    if (ticking) return; // re-entrancy guard (slow fetch vs interval)
    ticking = true;
    try {
      const logins = listStreamers(db).map(s => s.login);
      if (!logins.length) {
        lastStatuses = [];
        bus.emit('status', { statuses: [], stale: false });
        return;
      }
      let statuses: StreamStatus[];
      try {
        statuses = await fetchStatuses(logins);
        failCount = 0;
      } catch {
        failCount++;
        bus.emit('status', { statuses: lastStatuses, stale: isStale() });
        return;
      }
      for (const s of statuses) {
        if (s.avatarUrl || s.displayName !== s.login) updateStreamerMeta(db, s.login, s.displayName, s.avatarUrl);
        const wasLive = consideredLive.get(s.login) ?? false;
        if (s.live) {
          offlineCount.set(s.login, 0);
          if (!wasLive) {
            consideredLive.set(s.login, true);
            touchLastLive(db, s.login, nowIso());
            bus.emit('live', s);
          }
        } else if (wasLive) {
          const c = (offlineCount.get(s.login) ?? 0) + 1;
          offlineCount.set(s.login, c);
          if (c >= OFFLINE_POLLS_REQUIRED) {
            consideredLive.set(s.login, false);
            offlineCount.set(s.login, 0);
            bus.emit('offline', s.login);
          }
        }
      }
      lastStatuses = statuses;
      bus.emit('status', { statuses, stale: false });
    } finally {
      ticking = false;
    }
  }

  function isStale(): boolean { return failCount >= STALE_AFTER_FAILURES; }

  return {
    tick,
    start() {
      if (timer) return;
      void tick();
      const schedule = () => {
        const ms = Math.max(30, parseInt(getSetting(db, 'poll_interval_s'), 10) || 60) * 1000;
        timer = setTimeout(async () => { await tick(); schedule(); }, ms);
      };
      schedule();
    },
    stop() { if (timer) clearTimeout(timer); timer = null; },
    getStatuses: () => lastStatuses,
    isConsideredLive: (login) => consideredLive.get(login) ?? false,
    isStale,
  };
}
