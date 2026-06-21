import { createRoot } from 'react-dom/client';
import { useState, useEffect, useMemo, useCallback, useRef, lazy, Suspense } from 'react';
import { registerSW } from 'virtual:pwa-register';
import { Analytics } from '@vercel/analytics/react';
import { SpeedInsights } from '@vercel/speed-insights/react';
import { Root } from './App';
import { useAuth } from './lib/auth';
import { stashPostAuthPath, consumePostAuthPath } from './lib/routes';
import { ConsentBanner } from './components/ConsentBanner';
import { UpdatePrompt } from './components/UpdatePrompt';
import { getConsent, subscribeConsent } from './lib/consent';

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

  // Register the service worker after mount. registerType:'prompt' means a
  // waiting update never force-reloads — it applies on the next natural reopen.
  // Instead of a transient toast, surface a PERSISTENT UpdatePrompt with an
  // Update button that calls updateSW(true) (skip-waiting + reload into the
  // fresh build). Keep the returned updateSW fn in a ref so the button can fire it.
  const [needRefresh, setNeedRefresh] = useState(false);
  const updateSW = useRef(null);
  useEffect(() => {
    updateSW.current = registerSW({
      onNeedRefresh() { setNeedRefresh(true); },
    });
  }, []);

  // Legal pages take precedence over the auth gate so they're public AND
  // reachable while signed in.
  const view = useMemo(() => {
    if (loc.path === '/privacy') return 'privacy';
    if (loc.path === '/terms')   return 'terms';
    if (isAuthed) return 'app';
    if (loc.path === '/auth') return 'auth';
    return 'landing';
  }, [loc.path, isAuthed]);

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

  // Persistent SW-update banner — shown in every view (app + pre-auth).
  const updateBanner = needRefresh
    ? <UpdatePrompt onUpdate={() => updateSW.current?.(true)} onDismiss={() => setNeedRefresh(false)} />
    : null;

  if (view === 'app') return (
    <>
      <Root user={user} />
      {analyticsOn && <><Analytics /><SpeedInsights /></>}
      <ConsentBanner onPrivacy={() => navigate('/privacy')} />
      {updateBanner}
    </>
  );

  return (
    <>
      <div className={`theme-${theme}`}>
        <Suspense fallback={null}>
          {view === 'privacy'
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
      {updateBanner}
    </>
  );
}

createRoot(document.getElementById('root')).render(<AppRoot />);
