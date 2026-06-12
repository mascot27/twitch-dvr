import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, type RecordingView } from '../api';
import ChatReplay from '../components/ChatReplay';
import { fmtBytes, fmtDuration } from './Library';

export default function Player() {
  const { id } = useParams();
  const recId = Number(id);
  const [rec, setRec] = useState<RecordingView | null>(null);
  const [timeMs, setTimeMs] = useState(0);
  const [offsetMs, setOffsetMs] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const markedWatched = useRef(false);

  useEffect(() => {
    void api.recording(recId).then(r => { setRec(r); setOffsetMs(r.chatOffsetMs); });
  }, [recId]);

  // save resume position every 10s while playing
  useEffect(() => {
    const iv = setInterval(() => {
      const v = videoRef.current;
      if (v && !v.paused) void api.patchRecording(recId, { resumePositionS: v.currentTime });
    }, 10_000);
    return () => clearInterval(iv);
  }, [recId]);

  if (!rec) return <p className="muted">Loading…</p>;
  if (rec.status !== 'ready') return <p className="muted">This recording is {rec.status} — come back when it's ready.</p>;

  function nudge(deltaMs: number) {
    const next = offsetMs + deltaMs;
    setOffsetMs(next);
    void api.patchRecording(recId, { chatOffsetMs: next });
  }

  return (
    <>
      <h2>{rec.title || '(untitled)'} <span className="muted">— {rec.streamerLogin}</span></h2>
      <div className="muted">{new Date(rec.startedAt).toLocaleString()} · {rec.game || '—'} · {fmtDuration(rec.durationS)} · {fmtBytes(rec.sizeBytes)}</div>
      <div className="player" style={{ marginTop: 12 }}>
        <video
          ref={videoRef} src={rec.videoUrl} controls autoPlay playsInline
          onLoadedMetadata={e => {
            const v = e.currentTarget;
            if (rec.resumePositionS > 5 && rec.resumePositionS < rec.durationS - 10) v.currentTime = rec.resumePositionS;
          }}
          onPlay={() => {
            if (!markedWatched.current) {
              markedWatched.current = true;
              void api.patchRecording(recId, { watchedAt: new Date().toISOString() });
            }
          }}
          onTimeUpdate={e => setTimeMs(e.currentTarget.currentTime * 1000)}
        />
        <ChatReplay recordingId={recId} videoTimeMs={timeMs} offsetMs={offsetMs} onNudge={nudge} />
      </div>
    </>
  );
}
