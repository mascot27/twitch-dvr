import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type DiskView, type RecordingView } from '../api';
import { useAppState } from '../sse';

export function fmtBytes(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(0)} MB`;
  return `${Math.ceil(n / 1e3)} KB`;
}

export function fmtDuration(s: number): string {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h ? `${h}h${String(m).padStart(2, '0')}` : `${m}min`;
}

function DiskBar({ disk }: { disk: DiskView }) {
  const pct = Math.min(100, (disk.usedBytes / disk.capBytes) * 100);
  return (
    <div>
      <div className="diskbar"><div className={`fill${pct > 85 ? ' warn' : ''}`} style={{ width: `${pct}%` }} /></div>
      <span className="muted">{fmtBytes(disk.usedBytes)} of {fmtBytes(disk.capBytes)} cap · {fmtBytes(disk.freeBytes)} free on disk</span>
    </div>
  );
}

function Tile({ r, onChange }: { r: RecordingView; onChange: () => void }) {
  const date = new Date(r.startedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return (
    <div className="tile">
      <Link to={`/watch/${r.id}`}>
        <img className="thumb" src={r.thumbUrl} alt="" loading="lazy"
          onError={e => { (e.target as HTMLImageElement).style.visibility = 'hidden'; }} />
      </Link>
      {r.status === 'ready' && !r.watchedAt && <span className="dot" title="unwatched" />}
      <span className="duration">{r.status === 'ready' ? fmtDuration(r.durationS) : r.status.toUpperCase()}</span>
      <div className="body">
        <div className="title" title={r.title}><Link to={`/watch/${r.id}`}>{r.title || '(untitled)'}</Link></div>
        <div className="muted">{r.streamerLogin} · {r.game || '—'} · {date} · {fmtBytes(r.sizeBytes)}</div>
        <div className="row">
          <button className={`pin${r.pinned ? ' on' : ''}`} title={r.pinned ? 'unpin' : 'pin (never auto-delete)'}
            onClick={async () => { await api.patchRecording(r.id, { pinned: !r.pinned }); onChange(); }}>★</button>
          <button className="danger" onClick={async () => {
            if (confirm('Delete this recording from disk?')) { await api.deleteRecording(r.id); onChange(); }
          }}>Delete</button>
        </div>
      </div>
    </div>
  );
}

export default function Library() {
  const { recordingsVersion } = useAppState();
  const [recordings, setRecordings] = useState<RecordingView[]>([]);
  const [disk, setDisk] = useState<DiskView | null>(null);
  const [filter, setFilter] = useState('');
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    void api.recordings(filter || undefined).then(setRecordings);
    void api.disk().then(setDisk);
  }, [filter, refresh, recordingsVersion]);

  const logins = [...new Set(recordings.map(r => r.streamerLogin))].sort();

  return (
    <>
      <h2>Library</h2>
      {disk && <DiskBar disk={disk} />}
      <div className="row">
        <select value={filter} onChange={e => setFilter(e.target.value)}>
          <option value="">All streamers</option>
          {logins.map(l => <option key={l} value={l}>{l}</option>)}
        </select>
      </div>
      <div className="grid">
        {recordings.map(r => <Tile key={r.id} r={r} onChange={() => setRefresh(x => x + 1)} />)}
      </div>
      {!recordings.length && <p className="muted">No recordings yet. They appear here automatically when a tracked streamer goes live.</p>}
    </>
  );
}
