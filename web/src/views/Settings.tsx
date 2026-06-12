import { useEffect, useState } from 'react';
import { api, type SettingsView } from '../api';

export default function Settings() {
  const [settings, setSettings] = useState<SettingsView | null>(null);
  const [capInput, setCapInput] = useState('');
  const [pollInput, setPollInput] = useState('');
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [notifPerm, setNotifPerm] = useState(typeof Notification !== 'undefined' ? Notification.permission : 'denied');

  useEffect(() => {
    void api.settings().then(s => {
      setSettings(s);
      setCapInput(String(s.diskCapGb));
      setPollInput(String(s.pollIntervalS));
    });
  }, []);

  if (!settings) return <p className="muted">Loading…</p>;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(''); setSaved(false);
    try {
      await api.patchSettings({ diskCapGb: Number(capInput), pollIntervalS: Number(pollInput) });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) { setError(String((err as Error).message)); }
  }

  return (
    <>
      <h2>Settings</h2>
      <form className="settings-form" onSubmit={save}>
        <label>
          Disk cap (GB) — oldest unpinned recordings are deleted past this
          <input type="number" min="1" value={capInput} onChange={e => setCapInput(e.target.value)} />
        </label>
        <label>
          Status poll interval (seconds, min 30)
          <input type="number" min="30" value={pollInput} onChange={e => setPollInput(e.target.value)} />
        </label>
        <div className="row">
          <button className="primary">Save</button>
          {saved && <span style={{ color: 'var(--ok)' }}>Saved ✓</span>}
          {error && <span className="error">{error}</span>}
        </div>
        <hr style={{ border: 0, borderTop: '1px solid var(--bg3)', width: '100%' }} />
        <div className="muted">
          Data directory: <code>{settings.dataDir}</code><br />
          Server port and data directory are set in <code>config.json</code> (restart required).
        </div>
        <div className="row">
          <button type="button" disabled={notifPerm === 'granted'} onClick={async () => {
            setNotifPerm(await Notification.requestPermission());
          }}>
            {notifPerm === 'granted' ? 'Browser notifications enabled ✓' : 'Enable browser notifications'}
          </button>
        </div>
      </form>
    </>
  );
}
