import { EventEmitter } from 'node:events';
import type { RecordingRow, StreamStatus } from './types.js';

export interface BusEvents {
  live: (s: StreamStatus) => void;            // offline -> live transition
  offline: (login: string) => void;           // debounced (2 polls) live -> offline
  status: (p: { statuses: StreamStatus[]; stale: boolean }) => void; // every tick
  recording: (r: RecordingRow) => void;       // recording row changed
  notify: (n: { title: string; body: string }) => void; // user-facing notification
  'disk-low': (p: { freeBytes: number }) => void;
}

export interface Bus {
  on<K extends keyof BusEvents>(ev: K, fn: BusEvents[K]): void;
  off<K extends keyof BusEvents>(ev: K, fn: BusEvents[K]): void;
  emit<K extends keyof BusEvents>(ev: K, ...args: Parameters<BusEvents[K]>): void;
}

export function createBus(): Bus {
  const e = new EventEmitter();
  e.setMaxListeners(50);
  return {
    on: (ev, fn) => void e.on(ev, fn as (...a: unknown[]) => void),
    off: (ev, fn) => void e.off(ev, fn as (...a: unknown[]) => void),
    emit: (ev, ...args) => void e.emit(ev, ...args),
  };
}
