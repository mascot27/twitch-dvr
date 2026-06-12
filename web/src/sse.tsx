import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { StreamerView } from './api';

interface AppState {
  streamers: StreamerView[];
  stale: boolean;
  connected: boolean;
  recordingsVersion: number; // bump => library/player should refetch
}

const Ctx = createContext<AppState>({ streamers: [], stale: false, connected: false, recordingsVersion: 0 });
export const useAppState = () => useContext(Ctx);

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AppState>({ streamers: [], stale: false, connected: false, recordingsVersion: 0 });
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const es = new EventSource('/api/events');
    esRef.current = es;
    es.onopen = () => setState(s => ({ ...s, connected: true }));
    es.onerror = () => setState(s => ({ ...s, connected: false })); // EventSource auto-reconnects
    es.addEventListener('status', e => {
      const d = JSON.parse((e as MessageEvent).data) as { streamers: StreamerView[]; stale: boolean };
      setState(s => ({ ...s, streamers: d.streamers, stale: d.stale, connected: true }));
    });
    es.addEventListener('recording', () => {
      setState(s => ({ ...s, recordingsVersion: s.recordingsVersion + 1 }));
    });
    es.addEventListener('notify', e => {
      const n = JSON.parse((e as MessageEvent).data) as { title: string; body: string };
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        new Notification(n.title, { body: n.body });
      }
    });
    return () => es.close();
  }, []);

  return <Ctx.Provider value={state}>{children}</Ctx.Provider>;
}
