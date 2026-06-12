import { execFile } from 'node:child_process';
import type { Bus } from './events.js';

function esc(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export function buildOsascriptArgs(title: string, body: string): string[] {
  return ['-e', `display notification "${esc(body)}" with title "${esc(title)}"`];
}

export interface NotifierDeps {
  bus: Bus;
  execFn?: (cmd: string, args: string[]) => void;
}

export function createNotifier({ bus, execFn }: NotifierDeps): void {
  const run = execFn ?? ((cmd: string, args: string[]) => { execFile(cmd, args, err => { if (err) console.warn('[notifier] osascript failed:', err.message); }); });
  const toMac = (title: string, body: string) => run('osascript', buildOsascriptArgs(title, body));

  // every notify event (from recorder, disk monitor, or synthesized below) hits macOS
  bus.on('notify', n => toMac(n.title, n.body));

  // go-live: synthesize the notify event (SSE forwards it to browsers too)
  bus.on('live', s => bus.emit('notify', { title: `${s.displayName} is live`, body: s.title ?? '' }));

  bus.on('disk-low', p => bus.emit('notify', {
    title: 'Disk almost full',
    body: `Only ${(p.freeBytes / 1e9).toFixed(1)} GB free — new recordings are blocked.`,
  }));
}
