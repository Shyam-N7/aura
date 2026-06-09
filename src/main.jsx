import { createRoot } from 'react-dom/client';
import { useState, useEffect, useMemo, useCallback, lazy, Suspense } from 'react';
import { registerSW } from 'virtual:pwa-register';
import { Root } from './App';
import { useAuth } from './lib/auth';
import { toast } from './lib/toast';

import '@fontsource/hanken-grotesk/400.css';
import '@fontsource/hanken-grotesk/500.css';
import '@fontsource/hanken-grotesk/600.css';
import '@fontsource/fraunces/400.css';
import '@fontsource/fraunces/400-italic.css';
import '@fontsource/fraunces/500.css';
import '@fontsource/fraunces/600.css';

import './styles/global.css';
import './styles/animations.css';

// Pre-auth pages are code-split so their chunk (+ heavy 3D CSS) only loads for
// visitors who aren't signed in yet.
const LandingPage = lazy(() => import('./screens/LandingPage').then(m => ({ default: m.LandingPage })));
const AuthPage    = lazy(() => import('./screens/AuthPage').then(m => ({ default: m.AuthPage })));

// Body background while a pre-auth page is on screen, so the viewport edges
// match the theme during the page's own scroll/reflow.
const THEME_BG = { dusk: '#e9dfd1', midnight: '#1a1612', bloom: '#f3e8e4' };

function readTheme() {
  try { return localStorage.getItem('aura.theme') || 'dusk'; }
  catch { return 'dusk'; }
}

// Top-level view machine: landing → auth → app. The authed music app is the
// existing <Root> (portals its own responsive shell to body). Pre-auth pages
// render full-bleed into #root. View is derived from the auth token + path.
function AppRoot() {
  const { isAuthed, user } = useAuth();
  // Track pathname + search together so `authMode` (which reads the query
  // string) recomputes reactively on every navigation, not off a live
  // window.location read.
  const [loc, setLoc] = useState(() => ({
    path: window.location.pathname,
    search: window.location.search,
  }));

  useEffect(() => {
    const onPop = () => setLoc({ path: window.location.pathname, search: window.location.search });
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  // Register the service worker after mount. registerType:'prompt' means a
  // waiting update never force-reloads — it applies on the next natural reopen;
  // we surface a quiet "reopen to update" toast (the toast bus buffers it, so it
  // still shows even if raised before the in-app toast host has mounted).
  useEffect(() => {
    registerSW({
      onNeedRefresh() { toast('a new version is ready — reopen aura to update.'); },
    });
  }, []);

  const view = useMemo(() => {
    if (isAuthed) return 'app';
    if (loc.path === '/auth') return 'auth';
    return 'landing';
  }, [loc.path, isAuthed]);

  // Auth-page mode comes from ?mode=signup on entry; AuthPage owns it after.
  const authMode = useMemo(() => {
    try { return new URLSearchParams(loc.search).get('mode') === 'signup' ? 'signup' : 'signin'; }
    catch { return 'signin'; }
  }, [loc.search]);

  const navigate = (to) => {
    window.history.pushState(null, '', to);
    const url = new URL(to, window.location.origin);
    setLoc({ path: url.pathname, search: url.search });
  };

  // Theme for the pre-auth pages, read live from `aura.theme` each render so it
  // always reflects the latest choice (including one made in-app, then signed
  // out of). The nav toggle persists the next value and bumps a tick so the
  // new palette renders immediately.
  const [, bumpTheme] = useState(0);
  const theme = readTheme();
  const toggleTheme = useCallback(() => {
    const next = readTheme() === 'midnight' ? 'dusk' : 'midnight';
    try { localStorage.setItem('aura.theme', next); } catch { /* ignore */ }
    bumpTheme((n) => n + 1);
  }, []);
  useEffect(() => {
    if (view !== 'app') document.body.style.background = THEME_BG[theme] || THEME_BG.dusk;
  }, [view, theme]);

  if (view === 'app') return <Root user={user} />;

  return (
    <div className={`theme-${theme}`}>
      <Suspense fallback={null}>
        {view === 'auth'
          ? <AuthPage
              initialMode={authMode}
              onAuthed={() => navigate('/')}
              onBack={() => navigate('/')}
            />
          : <LandingPage
              onNavigateAuth={(mode) => navigate(mode === 'signup' ? '/auth?mode=signup' : '/auth')}
              theme={theme}
              onToggleTheme={toggleTheme}
            />}
      </Suspense>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<AppRoot />);
