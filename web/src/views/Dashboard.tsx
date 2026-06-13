import { useState } from 'react';
import { api, type StreamerView } from '../api';
import { useAppState } from '../sse';
import { QUALITY_PRESETS, presetLabel } from '../quality';

function uptime(startedAt: string | null): string {
  if (!startedAt) return '';
  const mins = Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 60000));
  return mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h${String(mins % 60).padStart(2, '0')}`;
}

function lastSeen(iso: string | null): string {
  if (!iso) return 'never seen live';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days === 0) return 'live earlier today';
  if (days === 1) return 'last live yesterday';
  return `last live ${days} days ago`;
}

function StreamerCard({ s }: { s: StreamerView }) {
  const [busy, setBusy] = useState(false);
  const act = (fn: () => Promise<unknown>) => async () => {
    setBusy(true);
    try { await fn(); } catch (e) { alert(String(e)); } finally { setBusy(false); }
  };
  return (
    <div className={`card${s.live ? ' live' : ''}`}>
      <img className="avatar" src={s.avatarUrl || undefined} alt="" />
      <div className="info">
        <div className="row">
          <strong>{s.displayName}</strong>
          {s.live && <span className="badge live">LIVE</span>}
          {s.recording && <span className="badge rec">REC</span>}
        </div>
        {s.live ? (
          <>
            <div className="title" title={s.title ?? ''}>{s.title}</div>
            <div className="muted">{s.game} · {uptime(s.startedAt)} · {s.viewers?.toLocaleString()} viewers</div>
            <div className="row">
              <a href={`https://twitch.tv/${s.login}`} target="_blank" rel="noreferrer">Watch on Twitch ↗</a>
              {s.recording
                ? <button disabled={busy} className="danger" onClick={act(() => api.recordStop(s.login))}>Stop recording</button>
                : <button disabled={busy} className="primary" onClick={act(() => api.recordStart(s.login))}>Record now</button>}
            </div>
          </>
        ) : (
          <div className="muted">offline — {lastSeen(s.lastLiveAt)}</div>
        )}
        <div className="row">
          <label className="muted" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" className="switch" checked={s.autoRecord} disabled={busy}
              onChange={act(() => api.patchStreamer(s.login, { autoRecord: !s.autoRecord }))} />
            auto-record
          </label>
          <select
            className="quality"
            title="Recording quality — applies to the next recording, not one in progress"
            value={s.quality}
            disabled={busy}
            onChange={e => { const quality = e.target.value; act(() => api.patchStreamer(s.login, { quality }))(); }}
          >
            {presetLabel(s.quality) === 'Custom' && <option value={s.quality}>Custom ({s.quality})</option>}
            {QUALITY_PRESETS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
          <button disabled={busy} onClick={act(async () => {
            if (confirm(`Remove ${s.displayName}? Recordings are kept.`)) await api.deleteStreamer(s.login);
          })}>Remove</button>
        </div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { streamers } = useAppState();
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim()) return;
    setAdding(true); setError('');
    try { await api.addStreamer(input); setInput(''); }
    catch (err) { setError(String((err as Error).message)); }
    finally { setAdding(false); }
  }

  const sorted = [...streamers].sort((a, b) =>
    Number(b.live) - Number(a.live) || a.displayName.localeCompare(b.displayName));

  return (
    <>
      <h2>Streamers</h2>
      <form className="addform" onSubmit={add}>
        <input placeholder="twitch.tv/channel or channel name" value={input}
          onChange={e => setInput(e.target.value)} disabled={adding} />
        <button className="primary" disabled={adding}>Add</button>
      </form>
      {error && <div className="error">{error}</div>}
      <div className="cards">
        {sorted.map(s => <StreamerCard key={s.login} s={s} />)}
      </div>
      {!streamers.length && <p className="muted">No streamers yet — add one above (e.g. <code>twitch.tv/streamertwo</code>).</p>}
    </>
  );
}
