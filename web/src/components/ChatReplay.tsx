import { useEffect, useMemo, useRef, useState } from 'react';
import { api, type ChatLine } from '../api';
import { badgeUrl, emoteUrl, segmentMessage } from '../emotes';

const WINDOW_MS = 120_000;
const MAX_VISIBLE = 150;

function Line({ line }: { line: ChatLine }) {
  if (line.type === 'system') return <div className="chatline system">{line.text}</div>;
  return (
    <div className="chatline">
      {(line.badges ?? []).map(b => {
        const url = badgeUrl(b);
        return url ? <img key={b} className="badgeicon" src={url} alt={b} title={b} /> : null;
      })}
      <span className="name" style={{ color: line.color || '#a970ff' }}>{line.display || line.user}</span>
      <span className="muted">: </span>
      {segmentMessage(line.text, line.emotes ?? []).map((seg, i) =>
        seg.kind === 'text'
          ? <span key={i}>{seg.text}</span>
          : <img key={i} className="emote" src={emoteUrl(seg.id)} alt={seg.alt} title={seg.alt} />)}
    </div>
  );
}

export default function ChatReplay({ recordingId, videoTimeMs, offsetMs, onNudge }: {
  recordingId: number;
  videoTimeMs: number;
  offsetMs: number;
  onNudge: (deltaMs: number) => void;
}) {
  const windowsRef = useRef(new Map<number, ChatLine[]>());
  const loadingRef = useRef(new Set<number>());
  const [version, setVersion] = useState(0);
  const logRef = useRef<HTMLDivElement>(null);
  const chatTimeMs = videoTimeMs + offsetMs;
  const currentWindow = Math.max(0, Math.floor(chatTimeMs / WINDOW_MS));

  useEffect(() => {
    for (const k of [currentWindow, currentWindow + 1]) {
      if (windowsRef.current.has(k) || loadingRef.current.has(k)) continue;
      loadingRef.current.add(k);
      api.chat(recordingId, k * WINDOW_MS, (k + 1) * WINDOW_MS)
        .then(lines => { windowsRef.current.set(k, lines); setVersion(v => v + 1); })
        .catch(() => { /* transient; refetched only if the user seeks back into this window */ })
        .finally(() => loadingRef.current.delete(k));
    }
  }, [recordingId, currentWindow]);

  const visible = useMemo(() => {
    const out: ChatLine[] = [];
    for (let k = Math.max(0, currentWindow - 3); k <= currentWindow; k++) {
      for (const l of windowsRef.current.get(k) ?? []) {
        if (l.t <= chatTimeMs) out.push(l);
      }
    }
    return out.slice(-MAX_VISIBLE);
  }, [chatTimeMs, currentWindow, version]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [visible.length, visible[visible.length - 1]?.t]);

  return (
    <div className="chatpane">
      <div className="head">
        <strong>Chat replay</strong>
        <span className="row muted">
          sync
          <button onClick={() => onNudge(-5000)} title="chat 5s earlier">-5s</button>
          <button onClick={() => onNudge(-1000)}>-1s</button>
          <button onClick={() => onNudge(1000)}>+1s</button>
          <button onClick={() => onNudge(5000)} title="chat 5s later">+5s</button>
          {offsetMs !== 0 && <span>{offsetMs > 0 ? '+' : ''}{(offsetMs / 1000).toFixed(0)}s</span>}
        </span>
      </div>
      <div className="chatlog" ref={logRef}>
        {visible.map((l, i) => <Line key={`${l.t}-${i}`} line={l} />)}
        {!visible.length && <div className="muted">No chat messages yet at this point.</div>}
      </div>
    </div>
  );
}
