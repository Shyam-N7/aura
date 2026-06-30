import { createRoot } from 'react-dom/client';
import { useState, useEffect, useMemo, useCallback, lazy, Suspense } from 'react';
import { registerSW } from 'virtual:pwa-register';
import { Analytics } from '@vercel/analytics/react';
import { SpeedInsights } from '@vercel/speed-insights/react';
import { Root } from './App';
import { useAuth } from './lib/auth';
import { stashPostAuthPath, consumePostAuthPath } from './lib/routes';
import { ConsentBanner } from './components/ConsentBanner';
import { UpdatePrompt } from './components/UpdatePrompt';
import { markUpdateReady, subscribeUpdate, applyUpdate, consumeJustUpdated } from './lib/appUpdate';
import { getConsent, subscribeConsent } from './lib/consent';
import { confirm } from './lib/confirm';
import { initExitGuard, setExitGuard } from './lib/exitGuard';

// One-time legacy redirect: the app used hash routes (`#/artist/x`) before the
// path-routing migration — rewrite them to real paths so old bookmarks, shares,
// and installed-PWA launches (`start_url '/#/'`) keep working. Matches ONLY
// '#/'-prefixed hashes: the landing page's section anchors ('#how',
// '#features') and bare '#' stub links must pass through untouched. Runs before
// first render so every initial-route read sees the corrected URL.
{
  const h = window.location.hash;
  if (h.startsWith('#/')) {
    const path = h.slice(1) || '/';
    try { window.history.replaceState(null, '', path + window.location.search); } catch { /* ignore */ }
  }
}

import '@fontsource/hanken-grotesk/400.css';
import '@fontsource/hanken-grotesk/500.css';
import '@fontsource/hanken-grotesk/600.css';

import './styles/global.css';
import './styles/animations.css';

// Pre-auth pages are code-split so their chunk (+ heavy 3D CSS) only loads for
// visitors who aren't signed in yet.
const LandingPage = lazy(() => import('./screens/LandingPage').then(m => ({ default: m.LandingPage })));
const AuthPage    = lazy(() => import('./screens/AuthPage').then(m => ({ default: m.AuthPage })));
// Public legal pages — reachable signed-out or in, so they sit at the top of the
// view machine below.
const PrivacyPage = lazy(() => import('./screens/PrivacyPage').then(m => ({ default: m.PrivacyPage })));
const TermsPage   = lazy(() => import('./screens/TermsPage').then(m => ({ default: m.TermsPage })));
// Public view-only playlist page — opens for anyone at /p/:publicId, signed in or
// out, so it sits above the auth gate alongside the legal pages.
const PublicPlaylistScreen = lazy(() => import('./screens/PublicPlaylistScreen').then(m => ({ default: m.PublicPlaylistScreen })));

// Body background while a pre-auth page is on screen, so the viewport edges
// match the theme during the page's own scroll/reflow.
const THEME_BG = { dusk: '#e9dfd1', midnight: '#1a1612', bloom: '#f3e8e4' };

// Theme cycle shared with the in-app toggle: light → dark → pink → light.
const NEXT_THEME = { dusk: 'midnight', midnight: 'bloom', bloom: 'dusk' };

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

  // A logged-out visitor at an app deep link (e.g. /artist/x, or a playlist
  // share link /playlists?join=TOKEN) sees the landing page, and heading into
  // /auth would wipe the path — stash it so sign-in can land them where the link
  // pointed. Include the QUERY so the ?join= invite token survives the bounce.
  // Reads the LIVE location (not loc.path): sign-out pushes '/' synchronously
  // before this runs, so nothing stale is stashed. Consumed in onAuthed below.
  useEffect(() => {
    if (!isAuthed) stashPostAuthPath(window.location.pathname + window.location.search);
  }, [isAuthed]);

  // Register the service worker after mount, poll for new builds, and hand a
  // waiting update to the shared controller. registerType:'prompt' keeps the old
  // bundle running until WE call updateSW(true) — so the update applies ITSELF at a
  // safe moment instead of needing a manual click or a tab close/reopen: the authed
  // app applies it playback-aware (App.jsx, never mid-song); pre-auth views (no
  // playback) apply on the next navigation below. The 60s poll lets a long-open tab
  // notice a deploy without a manual refresh.
  useEffect(() => {
    const updateSW = registerSW({
      onRegisteredSW(_swUrl, r) {
        if (r) setInterval(() => { r.update().catch(() => {}); }, 60_000);
      },
      onNeedRefresh() { markUpdateReady(() => updateSW?.(true)); },
    });
  }, []);
  const [updateReady, setUpdateReady] = useState(false);
  useEffect(() => subscribeUpdate(setUpdateReady), []);

  // Legal pages take precedence over the auth gate so they're public AND
  // reachable while signed in.
  const view = useMemo(() => {
    if (loc.path === '/privacy') return 'privacy';
    if (loc.path === '/terms')   return 'terms';
    // Public share links open for everyone, signed in or out — before the auth gate.
    if (loc.path.startsWith('/p/')) return 'public-playlist';
    if (isAuthed) return 'app';
    if (loc.path === '/auth') return 'auth';
    return 'landing';
  }, [loc.path, isAuthed]);

  // Pre-auth pages have no playback — apply a pending update on the next
  // navigation (a natural reload point). The authed app applies it playback-aware
  // in App.jsx, so skip here when the app view is showing.
  useEffect(() => {
    if (updateReady && view !== 'app') applyUpdate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loc.path, loc.search]);

  // Back-button exit guard — armed only while the authed app is showing, so a
  // stray Back asks before leaving instead of dropping the user out. Inert on
  // landing / auth / legal pages (normal Back).
  useEffect(() => {
    setExitGuard(view === 'app', () => confirm({
      title: 'Leave AURA?',
      body: 'Your music will stop if you leave.',
      confirmLabel: 'Leave',
      cancelLabel: 'Stay',
    }));
  }, [view]);

  // Analytics consent — Vercel Analytics / Speed Insights load only once granted.
  const [consent, setConsentState] = useState(getConsent());
  useEffect(() => subscribeConsent(setConsentState), []);
  const analyticsOn = consent === 'granted';

  // Pre-auth tab titles (in-app titles are managed per screen by App).
  useEffect(() => {
    if (view === 'auth')         document.title = 'sign in · AURA FM';
    else if (view === 'landing') document.title = 'AURA FM — AI radio that reads your mood';
    else if (view === 'privacy') document.title = 'Privacy · AURA FM';
    else if (view === 'terms')   document.title = 'Terms · AURA FM';
  }, [view]);

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
    const next = NEXT_THEME[readTheme()] || 'midnight';
    try { localStorage.setItem('aura.theme', next); } catch { /* ignore */ }
    bumpTheme((n) => n + 1);
  }, []);
  useEffect(() => {
    if (view !== 'app') document.body.style.background = THEME_BG[theme] || THEME_BG.dusk;
  }, [view, theme]);

  // After an auto-update reload, show a brief, self-dismissing confirmation toast
  // (the flag rode the reload via sessionStorage). No action needed — the update
  // already applied — so it just fades out.
  const [justUpdated, setJustUpdated] = useState(() => consumeJustUpdated());
  useEffect(() => {
    if (!justUpdated) return undefined;
    const t = setTimeout(() => setJustUpdated(false), 3500);
    return () => clearTimeout(t);
  }, [justUpdated]);
  const updateToast = justUpdated
    ? <UpdatePrompt onDismiss={() => setJustUpdated(false)} />
    : null;

  if (view === 'app') return (
    <>
      <Root user={user} />
      {analyticsOn && <><Analytics /><SpeedInsights /></>}
      <ConsentBanner onPrivacy={() => navigate('/privacy')} />
      {updateToast}
    </>
  );

  return (
    <>
      <div className={`theme-${theme}`}>
        <Suspense fallback={null}>
          {view === 'public-playlist'
            ? <PublicPlaylistScreen publicId={decodeURIComponent(loc.path.slice(3))} isAuthed={isAuthed} onNavigate={navigate} />
            : view === 'privacy'
            ? <PrivacyPage onBack={() => navigate('/')} />
            : view === 'terms'
            ? <TermsPage onBack={() => navigate('/')} />
            : view === 'auth'
            ? <AuthPage
                initialMode={authMode}
                onAuthed={() => navigate(consumePostAuthPath() ?? '/')}
                onBack={() => navigate('/')}
              />
            : <LandingPage
                onNavigate={navigate}
                onNavigateAuth={(mode) => navigate(mode === 'signup' ? '/auth?mode=signup' : '/auth')}
                theme={theme}
                onToggleTheme={toggleTheme}
              />}
        </Suspense>
      </div>
      {analyticsOn && <><Analytics /><SpeedInsights /></>}
      <ConsentBanner onPrivacy={() => navigate('/privacy')} />
      {updateToast}
    </>
  );
}

// Register the Back-button exit guard before React mounts, so its popstate
// listener runs ahead of the routing listeners.
initExitGuard();

createRoot(document.getElementById('root')).render(<AppRoot />);
