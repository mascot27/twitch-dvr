import { BrowserRouter, NavLink, Route, Routes } from 'react-router-dom';
import { AppStateProvider, useAppState } from './sse';
import Dashboard from './views/Dashboard';
import Library from './views/Library';
import Player from './views/Player';
import Settings from './views/Settings';

function StaleBanner() {
  const { stale, connected } = useAppState();
  if (!connected) return <div className="banner warn">Reconnecting to server…</div>;
  if (stale) return <div className="banner warn">Twitch status checks failing — showing last known state</div>;
  return null;
}

export default function App() {
  return (
    <AppStateProvider>
      <BrowserRouter>
        <nav className="topnav">
          <span className="brand">📼 Twitch DVR</span>
          <NavLink to="/" end>Dashboard</NavLink>
          <NavLink to="/library">Library</NavLink>
          <NavLink to="/settings">Settings</NavLink>
        </nav>
        <StaleBanner />
        <main>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/library" element={<Library />} />
            <Route path="/watch/:id" element={<Player />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </main>
      </BrowserRouter>
    </AppStateProvider>
  );
}
