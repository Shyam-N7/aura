import { useState, useEffect, useMemo, useRef, useCallback, lazy, Suspense } from 'react';
import { createPortal } from 'react-dom';
import { THEMES } from './data';
import { useFeaturedTracks } from './hooks/useFeaturedTracks';

// Mobile-first screens with no desktop variant — rendered as-is at every width
// (the sensing/onboarding gates and the playlists screen).
import { SensingScreen } from './screens/SensingScreen';
import { OnboardingScreen } from './screens/OnboardingScreen';
import { PlaylistsScreen } from './screens/PlaylistsScreen';

import { WhyPanel } from './screens/overlays/WhyPanel';
import { LyricsScreen } from './screens/overlays/LyricsScreen';
import { CrowdScreen } from './screens/overlays/CrowdScreen';

import { MorphLayer } from './components/player/MorphLayer';
import { ScreenTransition } from './components/ScreenTransition';
import { MobileDock } from './components/nav/MobileDock';
import { MobileTopBar } from './components/nav/MobileTopBar';
import { GooFilter } from './components/GooFilter';
import { TapRipple } from './components/TapRipple';
import { useActiveScroll } from './hooks/useActiveScroll';
import { TalkAura } from './components/chat/TalkAura';
import { Toast } from './components/Toast';
import { PlayerDrawer } from './components/player/PlayerDrawer';
import { SpeedDial } from './components/SpeedDial';
import { AddToPlaylistSheet } from './components/AddToPlaylistSheet';
import { openAddToPlaylist } from './lib/addToPlaylistSheet';
import { openSleepTimer, closeSleepTimer, subscribeSleepSheet } from './lib/sleepTimerSheet';
import { ConfirmDialog } from './components/ConfirmDialog';
import { PromptDialog } from './components/PromptDialog';

import { useTweaks } from './tweaks/TweaksPanel';
import { TweaksHost } from './tweaks/TweaksHost';
import { useViewport, isDesktopBreakpoint, isCompactBreakpoint } from './hooks/useViewport';
import { useRailToggles } from './hooks/useRailToggles';
import { NavRail } from './components/nav/NavRail';
import { TopNavStrip } from './components/nav/TopNavStrip';
import { DesktopRail } from './components/player/DesktopRail';
import { FloatingMini } from './components/player/FloatingMini';
import { BottomMiniBar } from './components/player/BottomMiniBar';
import { ScreenSkeleton } from './screens/desktop/ScreenSkeleton';
import './styles/responsive.css';

// Desktop screens are code-split — each becomes its own Vite chunk fetched on
// first route hit. The named→default shim adapts our named exports to
// React.lazy's default-export contract.
const lazyNamed = (loader, name) => lazy(() => loader().then(m => ({ default: m[name] })));
const DesktopHome               = lazyNamed(() => import('./screens/desktop/DesktopHome'),               'DesktopHome');
const DesktopPlayer             = lazyNamed(() => import('./screens/desktop/DesktopPlayer'),             'DesktopPlayer');
const MobilePlayer              = lazyNamed(() => import('./screens/mobile/MobilePlayer'),               'MobilePlayer');
const CarPlayer                 = lazyNamed(() => import('./screens/mobile/CarPlayer'),                  'CarPlayer');
const DesktopJournal            = lazyNamed(() => import('./screens/desktop/DesktopJournal'),            'DesktopJournal');
const DesktopDna                = lazyNamed(() => import('./screens/desktop/DesktopDna'),                'DesktopDna');
const DesktopBridges            = lazyNamed(() => import('./screens/desktop/DesktopBridges'),            'DesktopBridges');
const DesktopLibrary            = lazyNamed(() => import('./screens/desktop/DesktopLibrary'),            'DesktopLibrary');
const DesktopSearch             = lazyNamed(() => import('./screens/desktop/DesktopSearch'),             'DesktopSearch');
const DesktopTalk               = lazyNamed(() => import('./screens/desktop/DesktopTalk'),               'DesktopTalk');
const DesktopQueue              = lazyNamed(() => import('./screens/desktop/DesktopQueue'),              'DesktopQueue');
const DesktopPlaylistDetail     = lazyNamed(() => import('./screens/desktop/DesktopPlaylistDetail'),     'DesktopPlaylistDetail');
const DesktopCatalogPlaylistDetail = lazyNamed(() => import('./screens/desktop/DesktopCatalogPlaylistDetail'),'DesktopCatalogPlaylistDetail');
const DesktopAlbumDetail        = lazyNamed(() => import('./screens/desktop/DesktopAlbumDetail'),        'DesktopAlbumDetail');
const DesktopLanguageHub        = lazyNamed(() => import('./screens/desktop/DesktopLanguageHub'),        'DesktopLanguageHub');
const DesktopArtist             = lazyNamed(() => import('./screens/desktop/DesktopArtist'),             'DesktopArtist');
const DesktopLiked              = lazyNamed(() => import('./screens/desktop/DesktopLiked'),              'DesktopLiked');
const DesktopHistory            = lazyNamed(() => import('./screens/desktop/DesktopHistory'),            'DesktopHistory');
// First-run tour — loaded only the one time it actually shows.
const SiteTour                  = lazyNamed(() => import('./components/tour/SiteTour'),                  'SiteTour');

// Suspense fallback labels — shown while a screen's lazy chunk is fetching.
// Each entry mirrors the post-hydration loader copy in the destination screen
// so the label persists smoothly across the chunk-load → data-load transition.
const SCREEN_LABELS = {
  player:                  'Loading player',
  queue:                   'Loading queue',
  search:                  'Loading search',
  artist:                  'Loading artist',
  library:                 'Loading library',
  liked:                   'Loading liked songs',
  history:                 'Loading history',
  playlists:               'Loading playlists',
  'playlist-detail':       'Loading playlist',
  'catalog-playlist-detail': 'Loading playlist',
  'auto-playlist-detail':  'Loading playlist',
  'shared-playlist':       'Loading playlist',
  journal:                 'Loading journal',
  dna:                     'Building your sonic DNA',
  bridges:                 'Loading bridges',
  talk:                    'Opening chat',
};

import { useAudioPlayer } from './hooks/useAudioPlayer';
import { useListeningRecorder } from './hooks/useListeningRecorder';
import { usePlaybackPresence } from './hooks/usePlaybackPresence';
import { useLikes } from './hooks/useLikes';
import { useVoiceControl } from './hooks/useVoiceControl';
import { NowPlayingElsewhere } from './components/NowPlayingElsewhere';
import { onBroadcast } from './lib/broadcast';
import { useMediaSession } from './hooks/useMediaSession';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { ShortcutsOverlay } from './components/ShortcutsOverlay';
import { RotateOverlay } from './components/RotateOverlay';
import { SleepTimerSheet } from './components/SleepTimerSheet';
import { SleepTimerOrb } from './components/SleepTimerOrb';
import { TrackContextMenu } from './components/TrackContextMenu';
import { hasOnboarded } from './lib/onboarding';
import { hasSeenTour, subscribeTourRequest } from './lib/tour';
import { initSeen, unseenReleases, openWhatsNew } from './lib/whatsNew';
import { setHintsSuspended } from './lib/tapHint';
import { WhatsNewSheet } from './components/WhatsNewSheet';
import { getConsent, subscribeConsent } from './lib/consent';
import { usePathRoute } from './hooks/usePathRoute';
import { parsePath, pathIsActive } from './lib/routes';
import { loadQueue, saveQueueSoon } from './lib/persistentQueue';
import { savePosition, flush as flushPosition, loadPosition, clearPosition } from './lib/persistPosition';
import { getTrack } from './api/catalog';
import { getResume } from './lib/playback';
import { talk } from './api/talk';
import { matchLocalIntent, stripRequestVerb } from './lib/voiceIntents';
import { speak, stopSpeaking } from './lib/speak';
import { getSpokenConfirm } from './lib/carVoice';
import { getRelated } from './api/related';
import { prefetchLyrics } from './api/lyrics';
import { measureTrack } from './lib/loudness';
import { getLeveling } from './lib/audioLeveling';
import { titleKey, cleanTitle } from './utils/title';
import { setMeta } from './lib/meta';
import { requestSearchFocus } from './lib/searchFocus';
import { setSearchQuery } from './lib/searchQuery';
import { fireEndOfSetIfArmed, subscribeSleepFire } from './lib/sleepTimer';
import { useAuth, setActiveMode, showSensing, clearSession, applyBroadcastMode, fetchMe, isAuthed } from './lib/auth';
import { subscribeUpdate, applyUpdate } from './lib/appUpdate';
import { sensingShownToday, markSensingShown } from './lib/sensing';
import { dropExplicit } from './lib/explicit';
import { toast } from './lib/toast';
import { confirm } from './lib/confirm';
import { prompt } from './lib/prompt';
import { createPlaylist, addToPlaylist, getPublicPlaylist } from './api/playlists';

// ── Shared-element morph ──────────────────────────────────────────
// Viewport-relative rect — no more unscaling against the 402×874 stage,
// which was retired during the responsive flip. The morph layer lives in
// the same coordinate space as everything else now.
function getRect(el) {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}

// Live morph targets — read at morph time so the animation always lands on
// whatever element is currently on-screen. Fallback rects keep the morph
// from crashing when the target hasn't mounted yet.
function getPlayerArtRect() {
  const el = document.getElementById('player-art');
  if (el) return getRect(el);
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  // Phone: the player mounts AFTER this is read, so match MobilePlayer's large,
  // upper-centered cover (min(78vw, 46vh)) here — otherwise the morph lands on a
  // small centered square and pops to the real art. Wider screens keep the
  // desktop-sized fallback.
  if (vw < 600) {
    const size = Math.min(vw * 0.78, vh * 0.46);
    return { left: (vw - size) / 2, top: (vh - size) / 2 - vh * 0.08, width: size, height: size, radius: 10 };
  }
  const size = Math.min(360, vw * 0.4, vh * 0.4);
  return { left: (vw - size) / 2, top: (vh - size) / 2 - 20, width: size, height: size, radius: 6 };
}
// Radius lookup — bounding rects don't carry radius, so we re-attach it
// based on which target we're animating into.
const PLAYER_ART_RADIUS = 6;

// Persisted by Claude's design-tool harness: this comment block is rewritten
// in place via regex on disk, so don't move the markers or the const.
const DEFAULT_TWEAKS = /*EDITMODE-BEGIN*/{
  "djName": "AURA",
  "theme": "dusk",
  "mood": "calm",
  "skipSensing": false
}/*EDITMODE-END*/;

function App({ t, setTweak, breakpoint = 'mobile', rails = {} }) {
  const isDesktop         = isDesktopBreakpoint(breakpoint);
  const isCompact         = isCompactBreakpoint(breakpoint);
  const isMobile          = breakpoint === 'mobile';
  const isTabletLandscape = breakpoint === 'tablet-landscape';
  const isTabletPortrait  = breakpoint === 'tablet-portrait';
  // Drives the mobile bottom bar's liquid back-to-top morph: true while the
  // active screen is scrolled, with `scrollActiveUp` to send it back to the top.
  const { scrolled: barScrolled, toTop: scrollActiveUp } = useActiveScroll();
  const {
    navCollapsed = false, toggleNav = () => {},
    railCollapsed = false, toggleRail = () => {},
    setRailCollapsed = () => {},
  } = rails;
  // SensingScreen is a 402×874 mobile-first welcome — looks lost on desktop
  // viewports where the orb floats in empty space. Skip it at desktop+. Also
  // skip when the user has turned it off (a real preference) or has already seen
  // it today (once-per-day cadence) — that fixed ~6s intro on every cold load was
  // the frustration. The dev `skipSensing` tweak still forces it off everywhere.
  const shouldSkipSensing = t.skipSensing || isDesktop || !showSensing() || sensingShownToday();
  const isOnboarded = hasOnboarded();
  // If the user lands on a deep link, parse it so route params survive even
  // when the sensing/onboarding gate redirects them first. (Legacy `#/...`
  // URLs are rewritten to paths at boot in main.jsx, before this runs.)
  const initialFromPath = pathIsActive() ? parsePath(window.location.pathname) : null;
  // Snapshot whether persisted queue exists — `/player` cold-start without a
  // queue renders blank, so fall back to home in that case (mirrors apply()).
  const initialQueue = loadQueue();
  const hasPersistedQueue = !!initialQueue?.tracks?.length;
  const [screen, setScreen]         = useState(() => {
    // Gates take precedence over deep links: a first-run user can't bypass
    // sensing/onboarding by typing `/artist/123` into the URL bar.
    if (!shouldSkipSensing) return 'sensing';
    if (!isOnboarded)       return 'onboarding';
    if (!initialFromPath)   return 'home';
    if (initialFromPath.screen === 'player' && !hasPersistedQueue) return 'home';
    // Once onboarded, a stale `/onboarding` deep link should drop into home
    // instead of re-marking the user onboarded (harmless but confusing).
    if (initialFromPath.screen === 'onboarding') return 'home';
    return initialFromPath.screen;
  });
  const [overlay, setOverlay]       = useState(null);
  const [talkOpen, setTalkOpen]     = useState(false);
  // First-run site tour — auto-starts once per device (see effect below).
  const [tourActive, setTourActive] = useState(false);
  // Unified playback queue. Source 'tonight\'s set' wraps on end; everything
  // else stops at end. Insertions/reorders mutate `tracks` and adjust `idx`.
  // Cold-start: hydrate from localStorage if present so a reload picks up
  // where the user left off. Stale stream URLs get refetched below.
  const [queue, setQueue] = useState(() => initialQueue ?? { tracks: [], idx: 0, source: "tonight's set" });
  const [detailPlaylistId, setDetailPlaylistId] = useState(initialFromPath?.detailPlaylistId ?? null);
  const [catalogPlaylistId,  setCatalogPlaylistId]  = useState(initialFromPath?.catalogPlaylistId  ?? null);
  const [albumId,          setAlbumId]          = useState(initialFromPath?.albumId          ?? null);
  const [hubLang,          setHubLang]          = useState(initialFromPath?.hubLang          ?? null);
  // Track which screen the detail/hub views were opened from, so BACK goes
  // back to the right place (home vs playlists vs library vs language-hub).
  const [detailReturn,      setDetailReturn]     = useState('playlists');
  const [catalogReturn,       setCatalogReturn]      = useState('home');
  const [albumReturn,       setAlbumReturn]      = useState('home');
  // Auto "from your listening" sets are personal + ephemeral (computed per
  // request, no per-id endpoint), so we hold the whole object in memory and open
  // a read-only detail from it rather than routing by id. Not deep-linked: on a
  // hard refresh the URL falls back to home (buildPath maps unknown screens → '/').
  const [autoPlaylist,      setAutoPlaylist]     = useState(null);
  const [autoReturn,        setAutoReturn]       = useState('playlists');
  // A shared PUBLIC playlist opened in-app from a /p/:id link (?open= handoff).
  // Held in memory + rendered read-only via DesktopCatalogPlaylistDetail, exactly
  // like an auto playlist — not deep-linked, so a hard refresh falls back to home.
  const [sharedPlaylist,    setSharedPlaylist]   = useState(null);
  const [sharedReturn,      setSharedReturn]     = useState('home');
  const [artistKey,         setArtistKey]        = useState(initialFromPath?.artistKey ?? null);
  const [artistReturn,      setArtistReturn]     = useState('home');
  // Same back-stack pattern for player + queue so tapping back from the
  // queue (which can be opened from the player) returns to the player
  // instead of always dumping the user on home.
  const [queueReturn,       setQueueReturn]      = useState('home');
  const [playerReturn,      setPlayerReturn]     = useState('home');
  // journal / dna are reachable from both home and the library shelf (the only
  // route on mobile) — back returns to wherever they were opened from.
  const [journalReturn,     setJournalReturn]    = useState('home');
  const [dnaReturn,         setDnaReturn]        = useState('home');
  // Where closing the mobile search returns to (it can be opened from home,
  // library, etc. — and from the bottom nav).
  const [searchReturn,      setSearchReturn]     = useState('home');
  const [progress, setProgress]     = useState(0);
  const [audioTime, setAudioTime]   = useState(0);
  const [playing, setPlaying]       = useState(false);
  // True only when playback stops at a track's natural end with no auto-advance
  // (end of an explicit queue, or sleep-at-end). Drives the lyrics idle screen's
  // "Song ended" state; cleared whenever audio starts again (player 'play').
  const [ended, setEnded]           = useState(false);
  // Shuffle toggle for the up-next; auto-resets when the queue is replaced
  // wholesale (clear / pickLive / new source). Declared here with the other
  // playback state so the pick* handlers above shuffleQueue can reset it without
  // a use-before-declare.
  const [shuffleActive, setShuffleActive] = useState(false);

  // ── Boot refresh + auto-update ───────────────────────────────────────
  // Reconcile the cached identity with the server once on mount so a normal reload
  // picks up server-side changes (e.g. fields added by a migration) WITHOUT a
  // logout/login — the cached user paints first, fresh fields swap in when this
  // lands. fetchMe clears the session only on a real 401/403, so a transient blip
  // can't sign you out here.
  useEffect(() => { if (isAuthed()) fetchMe().catch(() => {}); }, []);
  // A new build (service worker) applies ITSELF, but only at a safe moment — never
  // mid-song. While nothing is playing, reload into the fresh build after a short
  // grace; while a track plays, defer until it pauses/ends (the `playing` dep
  // re-arms the timer on that transition). Deliberately NOT keyed on `screen` —
  // doing so let rapid in-app navigation perpetually reset the countdown so a ready
  // update never applied. Queue + position persist, so the reload lands where you were.
  const [updateReady, setUpdateReady] = useState(false);
  useEffect(() => subscribeUpdate(setUpdateReady), []);
  useEffect(() => {
    if (!updateReady || playing) return undefined;
    let t;
    const tick = () => {
      // Don't reload out from under active text entry (a family-PIN / delete-confirm
      // / rename mid-type) — re-check activeElement at fire time and re-arm.
      const el = document.activeElement;
      const editing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
      if (editing) { t = setTimeout(tick, 4000); return; }
      applyUpdate();
    };
    t = setTimeout(tick, 4000);
    return () => clearTimeout(t);
  }, [updateReady, playing]);
  const [morph, setMorph]           = useState(null); // { track, fromRect, toRect, kind }
  const morphTimer = useRef(null);
  const beginRaf   = useRef(0);       // the mobile-open #player-art poll rAF (cancellable)
  // Mobile open: suppress vaul's slide-from-bottom so the player fades in place
  // WHILE the cover morphs up — one cohesive "the bar grows into the screen"
  // motion instead of morph-then-slide. Cleared once the morph settles.
  const [instantPlayer, setInstantPlayer] = useState(false);
  // Mobile close: the reverse of the open — the cover morphs DOWN into the dock
  // bead while the drawer fades in place (no vaul slide). Drives the drawer's
  // fade-out (`closing` prop) and suppresses the bead's bud-in (`beadEnter`) so
  // the flying cover lands on a full-size bead. Cleared once the morph settles.
  const [closingMorph, setClosingMorph] = useState(false);
  // Container-transform origin — the bead's viewport centre. The player blooms
  // OUT of / collapses INTO this point (a clip-path circle, see PlayerDrawer.css),
  // so it reads as emerging from the now-playing disk. Set on open + close.
  const [bloomOrigin, setBloomOrigin] = useState(null); // { x, y }
  // While the player is closing, keep its wrapper mounted for ~220 ms so
  // the screen-out animation (scale + fade + slide) can run before the
  // wrapper unmounts. The destination screen is set immediately so it
  // renders behind the fading player.
  const [closingPlayer, setClosingPlayer] = useState(false);
  const closingPlayerTimer = useRef(null);
  // Same pattern for the lyrics overlay so its panel slides + fades out
  // instead of just popping when the user closes it (Phase 12).
  const [closingLyrics, setClosingLyrics] = useState(false);
  const closingLyricsTimer = useRef(null);
  // Same pattern for the mobile search screen so it sinks + fades back as the
  // top bar collapses out of search mode (both run 320 ms, finishing together).
  const [closingSearch, setClosingSearch] = useState(false);
  const closingSearchTimer = useRef(null);

  const { user } = useAuth();
  // The active listening mode drives the home pool (re-seeded server-side) and its
  // explicit policy. `mode` keys the featured fetch so switching refetches.
  const activeMode = user?.activeMode ?? 'everyday';
  const featured = useFeaturedTracks({ limit: 24, mode: activeMode });
  // Per-mode explicit policy (replaces the old global familyMode): the active mode
  // decides whether explicit tracks are dropped from the home pool so they never
  // reach the shelves, quick picks, "surprise me", or the queue derived from it.
  const explicitOff = useMemo(() => {
    const m = (user?.modes ?? []).find(x => x.key === activeMode);
    return m ? !!m.explicitOff : !!user?.familyMode;
  }, [user, activeMode]);
  const pool = useMemo(() => dropExplicit(featured.tracks, explicitOff), [featured.tracks, explicitOff]);

  // Record that the welcome intro played today, so the once-per-day cadence skips
  // it on subsequent cold loads (see shouldSkipSensing). Runs once on mount,
  // reading the initial screen decision.
  useEffect(() => {
    if (screen === 'sensing') markSensingShown();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // If an explicit-off mode is switched on mid-session (or restored on load),
  // prune explicit tracks already sitting in the live queue — keep the current
  // track playing and remap the index. New additions are filtered upstream (the
  // pool + getRelated), so this only catches a queue built while it was off.
  useEffect(() => {
    if (!explicitOff) return;
    // Functional updater returns the SAME queue reference when there's nothing
    // explicit to prune, so React bails out — no cascading render in the common
    // case. This is a one-shot reconcile on the explicit-off transition.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setQueue(q => {
      if (!q.tracks.length) return q;
      const curId = q.tracks[q.idx]?.id;
      const filtered = q.tracks.filter((t, i) => i === q.idx || !t?.explicit);
      if (filtered.length === q.tracks.length) return q;
      const idx = Math.max(0, filtered.findIndex(t => t.id === curId));
      return { ...q, tracks: filtered, idx };
    });
  }, [explicitOff]);

  // Switch listening mode. setActiveMode updates the session → useAuth re-renders
  // → activeMode changes → the featured pool refetches (re-seeded server-side).
  const switchMode = async (key) => {
    if (!key || key === activeMode) return;
    try {
      await setActiveMode(key);
      // Switching to Car Mode jumps straight to the driving dashboard (big controls
      // + hands-free) when there's something to play. The other entry — picking a
      // song while already in car mode — opens it via the normal play/morph flow.
      if (key === 'car' && isMobile && track && screen !== 'player') {
        setPlayerReturn(screen);
        setScreen('player');
      }
    }
    catch (err) { toast(err.message || 'could not switch mode'); }
  };

  // Path routing — sync `location.pathname` with screen + per-screen params
  // both ways. Cold-land on `/artist/abc` reads from initialFromPath above;
  // later mutations get mirrored back out via the effect inside usePathRoute.
  usePathRoute({
    enabled: true,
    current: { screen, artistKey, detailPlaylistId, catalogPlaylistId, albumId, hubLang },
    apply: (p) => {
      // /player with no track yet → fall back to home so we don't render a
      // blank screen. The user can navigate to /player once playback starts.
      // /onboarding once onboarded → home (mirrors cold-start gate above).
      let target = p.screen;
      if (target === 'player' && !queue.tracks.length) target = 'home';
      if (target === 'onboarding' && hasOnboarded()) target = 'home';
      setScreen(target);
      if (target === 'artist')                setArtistKey(p.artistKey ?? null);
      if (target === 'playlist-detail')       setDetailPlaylistId(p.detailPlaylistId ?? null);
      if (target === 'catalog-playlist-detail') setCatalogPlaylistId(p.catalogPlaylistId ?? null);
      if (target === 'album-detail')          setAlbumId(p.albumId ?? null);
      if (target === 'language-hub')          setHubLang(p.hubLang ?? null);
    },
  });

  // Until the user has interacted, the queue is empty and we derive the active
  // view from the featured pool. Any mutation (pick, enqueue, reorder, remove)
  // writes into `queue` and from then on the queue is the source of truth.
  const viewTracks = queue.tracks.length ? queue.tracks : pool;
  const viewIdx    = queue.tracks.length ? queue.idx    : 0;
  const viewSource = queue.tracks.length ? queue.source : "tonight's set";
  const isFeatured = viewSource === "tonight's set";
  const track      = viewTracks[viewIdx] ?? null;
  const next       = viewTracks[viewIdx + 1]
                  ?? (isFeatured && viewTracks.length ? viewTracks[0] : null);

  // Per-screen document titles (tab/history UX; becomes real SEO when guest
  // mode ships). Entity screens (artist/album/playlist) overwrite with their
  // fetched name once it lands — this effect re-asserts on every screen change,
  // so navigating away always restores the right title.
  useEffect(() => {
    const DEFAULT = 'AURA — your contemplative AI DJ';
    const MAP = {
      home: DEFAULT,
      search: 'search · AURA',
      library: 'library · AURA',
      liked: 'liked · AURA',
      history: 'history · AURA',
      playlists: 'playlists · AURA',
      'playlist-detail': 'playlist · AURA',
      'catalog-playlist-detail': 'playlist · AURA',
      'auto-playlist-detail': 'playlist · AURA',
      'shared-playlist': 'playlist · AURA',
      'album-detail': 'album · AURA',
      artist: 'artist · AURA',
      journal: 'journal · AURA',
      dna: 'sonic dna · AURA',
      bridges: 'mood bridges · AURA',
      talk: 'ask aura · AURA',
      queue: 'queue · AURA',
      onboarding: 'welcome · AURA',
    };
    let title = MAP[screen] ?? DEFAULT;
    if (screen === 'player') {
      title = track ? `${cleanTitle(track.title)} — ${track.artist} · AURA` : 'player · AURA';
    } else if (screen === 'language-hub' && hubLang) {
      title = `${hubLang} · AURA`;
    }
    setMeta({ title });
  }, [screen, track, hubLang]);

  // Auto-start the site tour: once per device, on a settled home screen, for
  // anyone onboarded who hasn't seen it (covers brand-new users right after
  // onboarding AND existing users who predate the tour — each exactly once;
  // every tour exit sets the flag, which survives logout like aura.theme).
  // Tablet-portrait is skipped this round — its TopNavStrip chrome has no
  // tour anchors yet. The 900ms delay lets the home screen-in animation land;
  // if the user navigates away first, the timer clears and re-arms on the
  // next home visit.
  useEffect(() => {
    if (tourActive) return undefined;
    if (screen !== 'home' || overlay || talkOpen) return undefined;
    if (isTabletPortrait) return undefined;
    if (!hasOnboarded() || hasSeenTour()) return undefined;
    const id = setTimeout(() => setTourActive(true), 900);
    return () => clearTimeout(id);
  }, [screen, overlay, talkOpen, isTabletPortrait, tourActive]);

  // Settings → "replay the tour". SiteTour self-navigates home via onNav, so
  // this works from any screen; tablet-portrait has no tour anchors (yet).
  useEffect(() => subscribeTourRequest(() => {
    if (isTabletPortrait) { toast('the tour needs a phone or desktop layout.'); return; }
    setTourActive(true);
  }), [isTabletPortrait]);

  // Tap hints stay quiet while the tour owns the screen.
  useEffect(() => { setHintsSuspended(tourActive); }, [tourActive]);

  // What's-new auto-open: version-gated (lib/whatsNew), on a settled home,
  // at most once per session, and NEVER in the same session as the tour —
  // one piece of guidance at a time. Brand-new users are silently marked
  // caught-up by initSeen(); the consent banner (z70, would cover the sheet)
  // must be answered first; never while the user is typing.
  const tourRanRef = useRef(false);
  const wnShownRef = useRef(false);
  // The banner blocks until answered (no dismiss-without-choice), so consent
  // null === banner on screen; re-check when the answer lands.
  const [consentTick, setConsentTick] = useState(0);
  useEffect(() => subscribeConsent(() => setConsentTick(n => n + 1)), []);
  useEffect(() => {
    if (tourActive) { tourRanRef.current = true; return undefined; }
    if (screen !== 'home' || overlay || talkOpen) return undefined;
    if (wnShownRef.current || tourRanRef.current) return undefined;
    if (!hasOnboarded() || !hasSeenTour()) return undefined;
    if (getConsent() === null) return undefined;
    initSeen();
    const pending = unseenReleases();
    if (!pending.length) return undefined;
    const id = setTimeout(() => {
      const ae = document.activeElement;
      if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
      wnShownRef.current = true;
      openWhatsNew({ releases: pending });
    }, 1500);
    return () => clearTimeout(id);
  }, [screen, overlay, talkOpen, tourActive, consentTick]);

  // Refs let event subscribers (player 'ended') read the latest state without
  // re-subscribing on every queue tick.
  const viewRef = useRef({ tracks: viewTracks, idx: viewIdx, source: viewSource });
  viewRef.current = { tracks: viewTracks, idx: viewIdx, source: viewSource };
  // Same pattern for `playing` — the wake watchdog reads the live intent.
  const playingRef = useRef(playing);
  playingRef.current = playing;

  const player = useAudioPlayer();
  useListeningRecorder({ player, track, mood: t.mood, language: track?.language, mode: activeMode, source: queue.source });
  // Near-real-time multi-device awareness — heartbeat this device + poll the others.
  const othersPlaying = usePlaybackPresence({ track, playing, progress });
  const { like } = useLikes();   // for hands-free "like" voice commands (Car Mode)

  // Cross-tab sync on this device: a logout / mode-switch in one tab reflects here.
  useEffect(() => onBroadcast((type, payload) => {
    if (type === 'logout') clearSession();
    else if (type === 'mode') applyBroadcastMode(payload);
  }), []);

  // Car Mode audio profile: force volume leveling on so music stays evenly loud
  // over road noise. Transient — restored when you leave car mode (never
  // overwrites the user's saved leveling preference). No EQ override here: the
  // Web Audio tap it needs kills screen-off playback on phones — the exact
  // scenario Car Mode exists for.
  useEffect(() => {
    if (!player) return;
    player.setLevelForce?.(activeMode === 'car');
  }, [player, activeMode]);

  // Cross-device resume: on cold boot, if another device was recently playing a
  // DIFFERENT track than this device's saved spot, offer to pick it up. Accepting
  // writes the position (the load effect auto-seeks) and plays it.
  const [resumeOffer, setResumeOffer] = useState(null);
  useEffect(() => {
    let stop = false;
    getResume().then((r) => {
      if (stop || !r?.track?.id) return;
      const local = loadPosition();
      const fresh = Date.now() - Number(r.at) < 24 * 60 * 60 * 1000;
      const worthIt = r.progress > 0.02 && r.progress < 0.98;
      if (fresh && worthIt && r.track.id !== local?.trackId && r.track.id !== track?.id) {
        setResumeOffer(r);
      }
    });
    return () => { stop = true; };
    // one-shot on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const acceptResume = () => {
    const r = resumeOffer;
    setResumeOffer(null);
    if (!r?.track?.id) return;
    savePosition(r.track.id, r.progress);   // the load effect seeks to this on load
    flushPosition();                        // write now so the load effect sees it
    pickLiveTrack(r.track);
  };
  useMediaSession({ track, playing, player, setPlaying, goNext: () => goNext(), goPrev: () => goPrev() });
  useKeyboardShortcuts({
    enabled: isDesktop,
    playing, setPlaying, player, track,
    goNext: () => goNext(),
    goPrev: () => goPrev(),
    onCycleRepeat: () => cycleRepeat(),
    onShuffle:     () => shuffleQueue(),
    onFocusSearch: () => {
      // Navigate to the search route if we're not there; the bus buffers the
      // focus request so DesktopSearch picks it up after it mounts.
      if (screen !== 'search') setScreen('search');
      requestSearchFocus();
    },
  });

  // ── Auto-radio: endless similar-track continuation ────────────────────
  // When the queue runs out on a non-wrapping source, we play a track similar
  // to the one that just ended (matching artist family / language / vibe).
  // Triggered by 'ended' AND by the user pressing next on the last track —
  // both consume the same prefetched batch.
  const autoNextRef          = useRef(null);   // { seedId, candidates } | null
  const autoFetchInFlightRef = useRef(false);  // a getRelated() is currently in flight
  // 'ended' | 'next' | null — set when the caller couldn't consume a candidate
  // synchronously (fetch still in flight) so the prefetch resolution knows to
  // apply directly + how to clean up on failure.
  const pendingApplyRef      = useRef(null);
  // Render mirror of autoNextRef. Refs don't trigger re-renders, but the queue
  // screen needs to surface the prefetched candidate as a "coming up" tile —
  // mutate both in lockstep at every callsite that touches autoNextRef.
  const [autoNextDisplay, setAutoNextDisplay] = useState(null);
  // Reactive mirror of autoFetchInFlightRef so the player can show a "finding
  // next song" placeholder while auto-radio resolves the next track.
  const [autoNextLoading, setAutoNextLoading] = useState(false);

  // Repeat mode: off | all | one. Persisted to localStorage. The 'ended'
  // subscriber reads via ref so we don't re-subscribe on every cycle.
  const [repeatMode, setRepeatMode] = useState(() => readStoredRepeat());
  const repeatModeRef = useRef(repeatMode);
  const loadedTrackIdRef = useRef(null);
  // Which track a load is CURRENTLY in flight for — lets the wake watchdog tell
  // "still loading" (leave it alone; the settle timeout bounds it) apart from
  // "load died" (re-kick). Cleared when the load settles either way.
  const loadingTrackIdRef = useRef(null);
  // Bumped by the wake watchdog to re-run the load effect when a load died while
  // the page was hidden (the player's _loadSeq makes the duplicate race-safe).
  const [loadNonce, setLoadNonce] = useState(0);
  useEffect(() => { repeatModeRef.current = repeatMode; }, [repeatMode]);
  useEffect(() => {
    try { localStorage.setItem('aura.repeat', repeatMode); } catch { /* ignore */ }
  }, [repeatMode]);
  // Cycle off → all → one → off. Drop any cached auto-radio candidate at the
  // same moment we enter a repeat mode — keeps the "after this set" tile from
  // sticking around when it could no longer be reached. (Done in the handler
  // rather than a useEffect to avoid the set-state-in-effect lint rule.)
  const cycleRepeat = () => {
    const next = repeatMode === 'off' ? 'all' : repeatMode === 'all' ? 'one' : 'off';
    setRepeatMode(next);
    if (next !== 'off') {
      autoNextRef.current = null;
      setAutoNextDisplay(null);
    }
  };

  // Builds the auto-radio queue from `cur` if a candidate is ready. Returns
  // null if no usable candidate — caller decides whether to wait or pause.
  const consumeAutoNext = (cur, offset = 0) => {
    const seed = cur.tracks[cur.idx];
    const auto = autoNextRef.current;
    if (!auto?.candidates?.length || !seed?.id || auto.seedId !== seed.id) return null;
    autoNextRef.current = null;
    setAutoNextDisplay(null);
    // Dedupe against the live queue so this path matches applyAutoRadioToQueue
    // (defensive — the prefetch clears on any queue change, so overlap is rare).
    // By id AND by normalized title, so a cover / alt-credit of a song already
    // in the queue (same title, different artist) never gets appended.
    const haveIds    = new Set(cur.tracks.map(t => t.id));
    const haveTitles = new Set(cur.tracks.map(t => titleKey(t.title)));
    const fresh = auto.candidates.filter(t => !haveIds.has(t.id) && !haveTitles.has(titleKey(t.title)));
    if (!fresh.length) return null;
    // Append the whole batch and play from `offset` within it (0 = the first
    // pick; a queue-page row click can start further down the batch).
    const jump = Math.min(Math.max(0, offset), fresh.length - 1);
    return {
      tracks: [...cur.tracks, ...fresh],
      idx: cur.idx + 1 + jump,
      source: 'more like this',
    };
  };

  // Functional setQueue that appends the candidate AT APPLY TIME — re-validates
  // against the freshest queue state so a user enqueue / track change between
  // fetch start and resolution doesn't trample anything.
  const applyAutoRadioToQueue = (seedId, candidates) => setQueue(q => {
    if (q.idx + 1 < q.tracks.length) return q;       // user enqueued mid-fetch
    if (q.source === "tonight's set") return q;       // wraps now
    const seedNow = q.tracks[q.idx];
    if (seedNow?.id !== seedId) return q;             // seed track changed
    // Dedupe vs current queue by id AND normalized title (drops covers of an
    // already-queued song).
    const haveIds    = new Set(q.tracks.map(t => t.id));
    const haveTitles = new Set(q.tracks.map(t => titleKey(t.title)));
    const fresh = candidates.filter(t => !haveIds.has(t.id) && !haveTitles.has(titleKey(t.title)));
    if (!fresh.length) return q;
    return {
      tracks: [...q.tracks, ...fresh],
      idx: q.idx + 1,
      source: 'more like this',
    };
  });

  // How many getRelated attempts one seed gets WHILE SOMEONE IS WAITING on it
  // (pendingApplyRef armed) before the radio gives up. Free-running prefetches
  // don't count — only need-it-now attempts do — so effect churn at track start
  // can never burn the budget reserved for the 'ended' / Next-click moment.
  // Bounds the self-heal so a genuinely dead endpoint can't loop.
  const AUTO_NEXT_MAX_TRIES = 2;
  const autoAttemptsRef = useRef({ seedId: null, tries: 0 });
  const canRetryAutoNext = (seedId) => {
    const a = autoAttemptsRef.current;
    return !!seedId && (a.seedId !== seedId || a.tries < AUTO_NEXT_MAX_TRIES);
  };
  // The retry paths aren't abortable (only the prefetch effect owns an
  // AbortController), so every resolution re-checks that its seed is still the
  // current LAST track before touching playback — a stale resolution landing
  // after the user picked something else must neither apply nor pause/resume.
  const seedStillCurrent = (seedId) => {
    const q = viewRef.current;
    return q.tracks[q.idx]?.id === seedId && q.idx + 1 >= q.tracks.length;
  };
  const toastNoNext = () => { if (!document.hidden) toast("couldn't find the next song."); };

  // The one auto-radio fetch, shared by the prefetch effect and the dead-end
  // retries. Dedupes against the LIVE queue (viewRef — fresher than any render
  // closure) and resolves through the same pendingApplyRef contract as before.
  // A transient failure while someone is waiting (pending set) retries itself
  // once within the attempt cap instead of silently killing the session — the
  // screen-off drive is exactly where that single network blip used to be fatal.
  const fetchAutoNext = (seed, { signal } = {}) => {
    const a = autoAttemptsRef.current;
    const counted = pendingApplyRef.current ? 1 : 0;   // only waited-on attempts count
    autoAttemptsRef.current = a.seedId === seed.id
      ? { seedId: seed.id, tries: a.tries + counted }
      : { seedId: seed.id, tries: counted };
    autoFetchInFlightRef.current = true;
    setAutoNextLoading(true);
    getRelated(seed.id, { lang: seed.language, limit: 15, signal })
      .then(list => {
        if (signal?.aborted) return;   // superseded by a newer prefetch
        autoFetchInFlightRef.current = false;
        setAutoNextLoading(false);
        // Dedupe vs the queue by id AND normalized title (covers / alt-credits of
        // an already-queued song share its title), and guard against repeats
        // within the batch itself. Keep the whole batch so the queue page can show
        // the continuation as a list and one consume fills it in at once. Picks
        // come ONLY from the similar-tracks source — never random/featured
        // tracks — so the radio stays strictly on-vibe even at a dead end.
        const live = viewRef.current.tracks;
        const seen = new Set(live.map(t => t.id));
        const seenTitles = new Set(live.map(t => titleKey(t.title)));
        const picks = [];
        for (const t of (list ?? [])) {
          const tk = titleKey(t?.title);
          if (!t?.id || seen.has(t.id) || seenTitles.has(tk)) continue;
          seen.add(t.id); seenTitles.add(tk);
          picks.push(t);
        }
        const pending = pendingApplyRef.current;
        if (!picks.length) {
          // No similar candidate left (a retry won't change a deterministic
          // empty answer). Pause only if the user was *waiting* on end-of-track
          // resolution FOR THIS SEED. A pending Next click leaves the current
          // track playing (clicks that did nothing have always been silent).
          if (pending === 'ended' && seedStillCurrent(seed.id)) {
            setPlaying(false);
            setEnded(true);
            toastNoNext();
          }
          pendingApplyRef.current = null;
          return;
        }
        if (pending) {
          pendingApplyRef.current = null;
          if (!seedStillCurrent(seed.id)) return;   // stale — the queue moved on
          applyAutoRadioToQueue(seed.id, picks);
          // User was waiting on this resolution — flip to playing so the load
          // effect autoplays the new track even if the audio element ended
          // (its paused property is true post-'ended', so we need this signal).
          setPlaying(true);
        } else {
          autoNextRef.current = { seedId: seed.id, candidates: picks };
          setAutoNextDisplay({ seedId: seed.id, candidates: picks });
        }
      })
      .catch(() => {
        if (signal?.aborted) return;   // stale abort — don't clear the live request's flags
        autoFetchInFlightRef.current = false;
        setAutoNextLoading(false);
        const pending = pendingApplyRef.current;
        if (!pending) return;   // nothing waiting — the dead-end retry covers it later
        if (!seedStillCurrent(seed.id)) { pendingApplyRef.current = null; return; }
        // Someone is waiting on this resolution: retry within the cap before
        // giving up (pending stays armed so the resolution still autoplays).
        if (canRetryAutoNext(seed.id)) {
          fetchAutoNextRef.current(seed);
          return;
        }
        if (pending === 'ended') {
          setPlaying(false);
          setEnded(true);
          toastNoNext();
        }
        pendingApplyRef.current = null;
      });
  };
  // Ref mirror so the mount-once 'ended' subscriber calls the fresh instance.
  const fetchAutoNextRef = useRef(fetchAutoNext);
  fetchAutoNextRef.current = fetchAutoNext;

  // Prefetch a continuation candidate when the current track becomes the last
  // in a non-wrapping queue. Fires once per (last-track, source) pair; aborts
  // on track change or unmount. On resolve, either stashes the candidate for
  // later consumption OR applies it directly if the user is already waiting
  // (pendingApplyRef set from a Next click or an 'ended' event).
  useEffect(() => {
    const atEnd = viewIdx === viewTracks.length - 1;
    // Treat repeat all/one as wrapping — no point fetching a candidate that
    // the 'ended' handler will ignore in favor of looping/replaying.
    const wraps = viewSource === "tonight's set" || repeatMode === 'all' || repeatMode === 'one';
    if (!atEnd || wraps || !track?.id) return undefined;
    if (autoNextRef.current?.seedId === track.id) return undefined;
    const ctl = new AbortController();
    autoNextRef.current = null;
    setAutoNextDisplay(null);
    fetchAutoNext({ id: track.id, language: track.language }, { signal: ctl.signal });
    return () => ctl.abort();
    // viewTracks intentionally omitted from deps — the effect only needs to
    // re-fire when the *current* track or its position changes. Including the
    // full array would re-fetch on every queue mutation (including the one
    // this effect itself triggers). fetchAutoNext is intentionally omitted too
    // (recreated per render; the effect only needs the identity-stable refs).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewIdx, viewTracks.length, track?.id, track?.language, viewSource, repeatMode]);

  // play() can reject on mobile (autoplay policy) or a dead/expired stream URL —
  // never let it fail silently. Log it; on an autoplay block, drop to paused so
  // the play button reappears and the user's next tap (a real gesture) resumes.
  // EXCEPT while hidden (screen off): flipping to paused there would cascade
  // through the sync effect into player.pause() → _intendedPlaying=false, which
  // disarms the player's on-wake self-heal — and nobody can see the toast anyway.
  // Keep the intent armed instead; the wake watchdog retries on screen-on.
  const safePlay = useCallback(() => {
    player.play()?.catch((err) => {
      console.warn('[player] play() rejected:', err?.name || '', err?.message || '');
      if (err?.name === 'NotAllowedError' && !document.hidden) {
        setPlaying(false);
        toast('tap play to resume.');
      }
    });
  }, [player]);

  // Subscribe to player events. 'ended' advances within the queue; on featured
  // we wrap around, on explicit sequences auto-radio takes over (or pauses if
  // no candidate). viewRef keeps us out of stale closures so we only subscribe
  // once per player instance.
  useEffect(() => {
    const offProgress = player.on('progress', (p, currentTimeSec) => {
      setProgress(p);
      setAudioTime(currentTimeSec ?? 0);
      const t = viewRef.current.tracks[viewRef.current.idx];
      if (t && t.id === loadedTrackIdRef.current) savePosition(t.id, p);
    });
    const offEnded    = player.on('ended', () => {
      clearPosition();
      // Repeat-one wins: replay current track from 0 regardless of position.
      if (repeatModeRef.current === 'one') {
        player.seek(0);
        safePlay();
        return;
      }
      const cur = viewRef.current;
      const canAdvance = cur.idx + 1 < cur.tracks.length;
      // Repeat-all wraps any queue (not just "tonight's set") at the end.
      const wraps = !canAdvance
        && (cur.source === "tonight's set" || repeatModeRef.current === 'all')
        && cur.tracks.length;
      if (import.meta.env.DEV) console.log('[player] ended →', { idx: cur.idx, len: cur.tracks.length, canAdvance, wraps: !!wraps });
      // If the user armed "sleep at end of set", a moment where we'd otherwise
      // wrap or stop is the sleep trigger — fire it and pause regardless.
      if (!canAdvance && fireEndOfSetIfArmed()) {
        setPlaying(false);
        setEnded(true);
        return;
      }
      if (canAdvance)      setQueue({ ...cur, idx: cur.idx + 1 });
      else if (wraps)      setQueue({ ...cur, idx: 0 });
      else {
        // Queue exhausted on a non-wrapping source — try auto-radio.
        const auto = consumeAutoNext(cur);
        if (auto) {
          setQueue(auto);
          // Audio element is in 'ended' state (paused). setPlaying(true) so the
          // load effect's `if (playing) player.play()` actually fires for the
          // newly appended track.
          setPlaying(true);
        }
        else if (autoFetchInFlightRef.current) {
          // Prefetch still running. Keep `playing: true` so the load effect
          // autoplays when the resolution applies the queue mutation.
          pendingApplyRef.current = 'ended';
        } else {
          // No candidate and no fetch in flight — the track-start prefetch
          // failed (flaky network in a moving car) or never fired. Retry right
          // now within the attempt cap, keeping the playing intent armed, so a
          // single transient blip doesn't end the session; only an exhausted
          // seed gives up (silently when hidden — nobody can see a toast).
          const seed = cur.tracks[cur.idx];
          if (seed?.id && canRetryAutoNext(seed.id)) {
            pendingApplyRef.current = 'ended';
            fetchAutoNextRef.current({ id: seed.id, language: seed.language });
          } else {
            setPlaying(false);
            setEnded(true);
            toastNoNext();
          }
        }
      }
    });
    const offPlay     = player.on('play', () => setEnded(false));
    // Audio element errored mid-playback — most often an expired CDN stream URL.
    // Refetch the current track's URL once so the load effect reloads + retries;
    // capped per track so a genuinely dead track can't loop.
    let errRetry = { id: null, tries: 0 };
    const offError = player.on('error', () => {
      const cur = viewRef.current;
      const t = cur.tracks[cur.idx];
      if (!t) return;
      if (errRetry.id !== t.id) errRetry = { id: t.id, tries: 0 };
      if (errRetry.tries >= 1) { console.warn('[player] giving up on track after retry:', t.id); return; }
      errRetry.tries += 1;
      getTrack(t.id).then(fresh => {
        // No fresh URL → the track is genuinely dead; the spent retry stops a loop.
        if (!fresh?.streamUrl) return;
        setQueue(q => ({ ...q, tracks: q.tracks.map(x => x.id === fresh.id ? { ...x, ...fresh } : x) }));
      }).catch(() => {});
    });
    return () => { offProgress(); offEnded(); offPlay(); offError(); };
  }, [player, safePlay]);

  // Flush playback position to localStorage on tab close AND when the page is
  // backgrounded (e.g. iOS screen-lock). If iOS then stalls/reloads the stream,
  // the load effect's position-restore resumes mid-track instead of from 0.
  //
  // Coming BACK to visible doubles as the wake watchdog: the screen turning on
  // is the only reliable recovery signal on a phone (background timers are
  // throttled to uselessness). If we still intend to be playing but the
  // transition died while hidden — a load that never settled because the media
  // pipeline was suspended before canplay, or a play() rejected in the
  // background — re-kick it now. A dead load re-runs via loadNonce; otherwise a
  // plain safePlay(), which is a no-op when audio is already rolling and also
  // resumes a suspended EQ/leveling graph. The progress guard skips the
  // ended-awaiting-auto-radio window, where play() would wrongly replay the
  // finished track from 0 — that hand-off is owned by the in-flight fetch.
  useEffect(() => {
    const flush = () => flushPosition();
    const onVis = () => {
      if (document.hidden) { flushPosition(); return; }
      if (!playingRef.current) return;
      const t = viewRef.current.tracks[viewRef.current.idx];
      if (!t) return;
      if (loadedTrackIdRef.current !== t.id) {
        // A load legitimately in flight rides its own (timeout-bounded) promise;
        // only a DEAD load — settled with neither success nor a live retry — is
        // re-kicked, so waking mid-load never restarts the buffering.
        if (loadingTrackIdRef.current === t.id) return;
        console.warn('[player] wake watchdog: reloading — the load died while hidden');
        setLoadNonce(n => n + 1);
      } else if (!player.isEnded?.() && player.getProgress() < 0.999) {
        safePlay();
      }
    };
    window.addEventListener('beforeunload', flush);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      window.removeEventListener('beforeunload', flush);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [player, safePlay]);

  // Sleep timer expiry → pause playback. Toast for visibility.
  useEffect(() => subscribeSleepFire((reason) => {
    setPlaying(false);
    toast(reason === 'end-of-set' ? 'set ended · sleeping.' : 'sleep timer · paused.');
  }), []);

  // Clear any in-flight close/morph animation timers on unmount — sign-out drops
  // <Root> entirely (main.jsx renders it only while authed), so a pending
  // setTimeout would otherwise fire setState on an unmounted tree.
  useEffect(() => () => {
    clearTimeout(morphTimer.current);
    cancelAnimationFrame(beginRaf.current);
    clearTimeout(closingPlayerTimer.current);
    clearTimeout(closingLyricsTimer.current);
    clearTimeout(closingSearchTimer.current);
  }, []);

  // Persist queue (debounced) on every meaningful change.
  useEffect(() => { saveQueueSoon(queue); }, [queue]);

  // Cold-start: persisted queue tracks lost their stream URLs (CDN tokens
  // rotate). Refetch fresh URLs for the active + next track so playback
  // can start cleanly. Others lazy-refetch when they become current.
  useEffect(() => {
    if (!queue.tracks.length) return;
    const idsToHydrate = [queue.tracks[queue.idx], queue.tracks[queue.idx + 1]]
      .filter(t => t && !t.streamUrl)
      .map(t => t.id);
    if (idsToHydrate.length === 0) return;
    let cancelled = false;
    Promise.all(idsToHydrate.map(id => getTrack(id).catch(() => null))).then(fresh => {
      if (cancelled) return;
      const byId = new Map(fresh.filter(Boolean).map(t => [t.id, t]));
      setQueue(q => ({
        ...q,
        tracks: q.tracks.map(t => byId.has(t.id) ? { ...t, ...byId.get(t.id) } : t),
      }));
    });
    return () => { cancelled = true; };
    // Only run once on mount with the hydrated queue — subsequent fetches
    // happen at the track-load layer when a non-hydrated track becomes
    // current. Including queue in deps would loop on every setQueue write.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load the active track whenever its identity OR stream URL changes. The
  // streamUrl dep covers the persisted-queue cold-start case where a track
  // is restored without a CDN URL and gets it lazily from `getTrack`.
  useEffect(() => {
    if (!track) return;
    let cancelled = false;
    loadedTrackIdRef.current = null;
    loadingTrackIdRef.current = track.id;
    player.load(track).then(() => {
      if (cancelled) return;
      loadingTrackIdRef.current = null;
      loadedTrackIdRef.current = track.id;
      const saved = loadPosition();
      if (saved && saved.trackId === track.id && saved.progress > 0.01 && saved.progress < 0.98) {
        player.seek(saved.progress);
      }
      if (playing && screen !== 'sensing') safePlay();
    }).catch(err => {
      if (!cancelled) loadingTrackIdRef.current = null;
      console.warn('[player] load failed', err);
    });
    return () => { cancelled = true; };
    // playing/screen captured in .then() — reconciled by the play/pause effect below.
    // loadNonce isn't read: it exists so the wake watchdog can force a re-load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player, track?.id, track?.streamUrl, loadNonce]);

  // Warm the lyrics cache for the current + next track shortly after a track
  // settles, so opening the Lyrics overlay is instant instead of a cold fetch
  // (provider call + Gemini romanization). The 1.2s debounce means rapid skips
  // don't fire prefetches for tracks the user blows past.
  useEffect(() => {
    if (!track?.id) return;
    const id = setTimeout(() => {
      prefetchLyrics(track.id);
      if (next?.id) prefetchLyrics(next.id);
    }, 1200);
    return () => clearTimeout(id);
  }, [track?.id, next?.id]);

  // Measure the upcoming track's loudness while the current one plays, so most
  // transitions are leveled on their first listen (the current track's own miss
  // is kicked by player.load). Gated on the leveling preference at fire time —
  // a user who turned leveling off must not pay the download. measureTrack
  // self-gates the rest — cache hit, hidden page, missing stream URL, in-flight
  // duplicate are all cheap no-ops.
  useEffect(() => {
    if (!next?.id) return;
    const id = setTimeout(() => { if (getLeveling()) measureTrack(next); }, 1500);
    return () => clearTimeout(id);
    // `next` identity churns with every queue write; its id is the real signal,
    // plus streamUrl for the persisted-queue cold start where the URL is merged
    // in after the id is already showing (same reason as the load effect above).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track?.id, next?.id, next?.streamUrl]);

  // Lazy stream-URL refetch for any track that loses its URL (cold-start
  // hydration didn't cover it, or it's track 3+ becoming current). Merges
  // the fresh URL back into the queue — the load effect above picks it up.
  useEffect(() => {
    if (!track || track.streamUrl) return;
    let cancelled = false;
    getTrack(track.id).then(fresh => {
      if (cancelled || !fresh) return;
      setQueue(q => ({
        ...q,
        tracks: q.tracks.map(t => t.id === fresh.id ? { ...t, ...fresh } : t),
      }));
    }).catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track?.id, track?.streamUrl]);

  // Sync play/pause state (and freeze playback during the sensing intro).
  useEffect(() => {
    if (screen === 'sensing' || !playing) {
      player.pause();
      flushPosition();
    } else {
      safePlay();
    }
  }, [player, playing, screen, safePlay]);

  // Operate on the hydrated view: when the user has never interacted, queue is
  // empty and we derive from pool; on first navigation we promote pool into
  // queue.tracks so subsequent mutations stick.
  const withCurrent = (mutator) => setQueue(q => {
    const cur = q.tracks.length ? q : { tracks: pool, idx: 0, source: "tonight's set" };
    return mutator(cur);
  });
  // Next / Prev clicks always intend "play me music" — every advance flips
  // playing → true so the load effect autoplays the new track even when the
  // user had paused before clicking (without this, a paused → next/prev just
  // swaps the metadata and stays silent).
  const goNext = () => {
    const q = viewRef.current.tracks.length
      ? viewRef.current
      : { tracks: pool, idx: 0, source: "tonight's set" };
    if (q.idx + 1 < q.tracks.length) {
      setQueue({ ...q, idx: q.idx + 1 });
      setPlaying(true);
      return;
    }
    if (q.tracks.length && (q.source === "tonight's set" || repeatModeRef.current === 'all')) {
      setQueue({ ...q, idx: 0 });
      setPlaying(true);
      return;
    }
    // Last track of a non-wrapping source → auto-radio.
    const auto = consumeAutoNext(q);
    if (auto) {
      setQueue(auto);
      setPlaying(true);
      return;
    }
    if (autoFetchInFlightRef.current) {
      pendingApplyRef.current = 'next';
      setPlaying(true);  // when the fetch lands and applies, load effect autoplays
      return;
    }
    // No candidate and nothing in flight (the prefetch failed earlier) — a Next
    // click used to be a silent no-op here. Retry within the attempt cap; the
    // resolution applies + autoplays exactly like the in-flight branch above.
    const seed = q.tracks[q.idx];
    if (seed?.id && canRetryAutoNext(seed.id)) {
      pendingApplyRef.current = 'next';
      fetchAutoNext({ id: seed.id, language: seed.language });
      setPlaying(true);
    }
  };
  const goPrev = () => {
    const q = viewRef.current.tracks.length
      ? viewRef.current
      : { tracks: pool, idx: 0, source: "tonight's set" };
    if (q.idx > 0) {
      setQueue({ ...q, idx: q.idx - 1 });
      setPlaying(true);
      return;
    }
    if (q.tracks.length && (q.source === "tonight's set" || repeatModeRef.current === 'all')) {
      setQueue({ ...q, idx: q.tracks.length - 1 });
      setPlaying(true);
    }
    // First track of a non-wrapping source → no-op (no "previous radio" concept).
  };

  // Morph helper — if we have a source element, animate the album art from
  // that rect into the player's art slot before mounting the player. Used by
  // every "open the player" path so the entrance is consistent.
  const morphInto = (target, srcEl, arrive) => {
    const fromRect = srcEl && getRect(srcEl);
    if (!(fromRect && fromRect.width > 0)) { arrive(); return; }
    clearTimeout(morphTimer.current);
    cancelAnimationFrame(beginRaf.current);   // drop any in-flight #player-art poll from a prior open
    // Reopening DURING a close-morph cancels that close's settle timer above —
    // clear its state here too so the reopened drawer never inherits a stranded
    // closing/instant flag (which would fade the just-opened player to nothing).
    setClosingMorph(false);
    if (isMobile) {
      // Bloom OUT of whatever was tapped (the bead, or a list item's art).
      setBloomOrigin({ x: fromRect.left + fromRect.width / 2, y: fromRect.top + fromRect.height / 2 });
      // Open the player NOW (drawer fades in place, no slide) so the rise IS the
      // cover morph — both run together as one motion. Because the drawer is in
      // place (not sliding), #player-art is already at its FINAL size, so we wait
      // a frame for it to mount and morph to its real rect — landing exactly on
      // the banner instead of the oversized pre-mount fallback. instantPlayer is
      // cleared when the morph settles, restoring vaul's normal drag/close.
      setInstantPlayer(true);
      arrive();
      const begin = (attempt = 0) => {
        const el = document.getElementById('player-art');
        if (!el && attempt < 6) { beginRaf.current = requestAnimationFrame(() => begin(attempt + 1)); return; }
        // Hold the flying cover soft (blur 12 → 12): the player's OWN banner does
        // the visible focus-in (un-blurs once the cover seats), so the handoff is
        // blurred→blurred→sharp with no pop. See PlayerDrawer.css (#player-art).
        const toRect = el
          ? { ...getRect(el), radius: 10, blur: 12 }                       // exact banner frame
          : { ...getPlayerArtRect(), radius: PLAYER_ART_RADIUS, blur: 12 }; // fallback (rare)
        setMorph({ track: target, fromRect: { ...fromRect, blur: 12 }, toRect, kind: 'open' });
        morphTimer.current = setTimeout(() => {
          requestAnimationFrame(() => requestAnimationFrame(() => setMorph(null)));
          setInstantPlayer(false);
        }, 470);
      };
      beginRaf.current = requestAnimationFrame(() => begin());
    } else {
      const toRect = { ...getPlayerArtRect(), radius: PLAYER_ART_RADIUS };
      setMorph({ track: target, fromRect, toRect, kind: 'open' });
      morphTimer.current = setTimeout(() => {
        arrive();
        requestAnimationFrame(() => requestAnimationFrame(() => setMorph(null)));
      }, 470);
    }
  };

  const pickLiveTrack = (t, srcEl) => {
    const fromScreen = screen;
    morphInto(t, srcEl, () => {
      setQueue({ tracks: [t], idx: 0, source: 'your pick' });
      setShuffleActive(false);
      setPlaying(true);
      setOverlay(null);
      setPlayerReturn(fromScreen);
      setScreen('player');
    });
  };

  const pickLiveSequence = (tracks, startIdx = 0, source = 'your selection', srcEl) => {
    if (!tracks?.length) return;
    const idx = Math.max(0, Math.min(startIdx, tracks.length - 1));
    const fromScreen = screen;
    morphInto(tracks[idx], srcEl, () => {
      setQueue({ tracks, idx, source });
      setShuffleActive(false);
      setPlaying(true);
      setOverlay(null);
      setPlayerReturn(fromScreen);
      setScreen('player');
    });
  };

  // Deep-link from a shared /p/:id page: a signed-in visitor tapped "Open in
  // AURA", which navigated here with ?open=<publicId>. Fetch that public playlist
  // and open it as a READ-ONLY in-app view — they browse and choose what to play
  // (editing / collaborating needs the separate ?join= invite; a public link is
  // view-only). Strip the param first so a refresh / StrictMode re-run can't
  // re-trigger. Mirrors the ?join= invite handoff. Play-time stream URLs resolve
  // lazily via getTrack once a track becomes current — no eager fetch here.
  useEffect(() => {
    let openId;
    try { openId = new URLSearchParams(window.location.search).get('open'); } catch { openId = null; }
    if (!openId) return undefined;
    try {
      const u = new URL(window.location.href);
      u.searchParams.delete('open');
      window.history.replaceState(null, '', u.pathname + u.search);
    } catch { /* ignore */ }
    getPublicPlaylist(openId)
      .then(pl => { setSharedPlaylist(pl); setSharedReturn('home'); setScreen('shared-playlist'); })
      .catch(() => { /* bad / removed link — just stay on home */ });
    // once on mount (only stable setters + the imported fetch are referenced)
  }, []);

  // Open the player on a track from the featured pool. Seeds the queue with
  // the pool starting at the picked idx so the rest of "tonight's set" remains.
  const pickById = (id, srcEl) => {
    const idx = pool.findIndex(x => x.id === id);
    if (idx < 0) return;
    const fromScreen = screen;
    morphInto(pool[idx], srcEl, () => {
      setQueue({ tracks: pool, idx, source: "tonight's set" });
      setShuffleActive(false);
      setPlaying(true);
      setPlayerReturn(fromScreen);
      setScreen('player');
      setOverlay(null);
    });
  };
  // Jump to position i within the *current* queue (not the pool).
  const pickFromQueue = (i) => withCurrent(q => ({ ...q, idx: Math.max(0, Math.min(i, q.tracks.length - 1)) }));

  // Queue mutations exposed to track context menus. Source flips from
  // "tonight's set" → "your set" on first insertion so wrap-around turns off.
  const enqueueNext = (t) => withCurrent(q => {
    const tracks = [...q.tracks];
    tracks.splice(q.idx + 1, 0, t);
    return { ...q, tracks, source: q.source === "tonight's set" ? 'your set' : q.source };
  });
  const enqueueLast = (t) => withCurrent(q => ({
    ...q,
    tracks: [...q.tracks, t],
    source: q.source === "tonight's set" ? 'your set' : q.source,
  }));
  const removeFromQueue = (i) => withCurrent(q => {
    if (i < 0 || i >= q.tracks.length) return q;
    const tracks = q.tracks.filter((_, k) => k !== i);
    let idx = q.idx;
    if (i < q.idx) idx -= 1;
    else if (i === q.idx) idx = Math.min(q.idx, tracks.length - 1);
    return { ...q, tracks, idx: Math.max(0, idx) };
  });
  const reorderQueue = (from, to) => withCurrent(q => {
    if (from === to || from < 0 || to < 0 || from >= q.tracks.length || to >= q.tracks.length) return q;
    const tracks = [...q.tracks];
    const [moved] = tracks.splice(from, 1);
    tracks.splice(to, 0, moved);
    let idx = q.idx;
    if (from === q.idx) idx = to;
    else if (from < q.idx && to >= q.idx) idx -= 1;
    else if (from > q.idx && to <= q.idx) idx += 1;
    return { ...q, tracks, idx };
  });
  // Spotify-style clear: keep the currently playing track, drop everything
  // else. The lone surviving track keeps queue.tracks.length === 1, so
  // withCurrent's pool fallback (empty → "tonight's set" pool) stays away —
  // any subsequent enqueueNext/Last lands in this fresh queue, not the pool.
  const clearQueue = async () => {
    const ok = await confirm({
      title:        'clear queue?',
      body:         "we'll keep the currently playing track.",
      confirmLabel: 'clear',
      danger:       true,
    });
    if (!ok) return;
    setQueue(q => {
      const cur = q.tracks.length ? q : { tracks: pool, idx: 0, source: "tonight's set" };
      const t = cur.tracks[cur.idx];
      if (!t) return { tracks: [], idx: 0, source: 'your set' };
      return { tracks: [t], idx: 0, source: 'your set' };
    });
    setShuffleActive(false);
    toast('queue cleared.');
  };
  // Sticky shuffle indicator. Tap (off → on) shuffles tracks[idx+1..] and
  // turns the button accent. Tap (on → off) just clears the indicator — the
  // queue order stays as-is (we don't store the pre-shuffle order, and most
  // users wanting an unshuffled set will pick a fresh source anyway).
  // Re-shuffle = tap off → tap on. Auto-resets to false whenever the queue
  // is replaced wholesale (clear / pickLive / new source). State declared up top
  // with the other playback state.
  const shuffleQueue = () => {
    if (shuffleActive) {
      setShuffleActive(false);
      return;
    }
    setQueue(q => {
      const cur = q.tracks.length ? q : { tracks: pool, idx: 0, source: "tonight's set" };
      if (cur.tracks.length < 2) return cur;  // nothing to shuffle
      const shuffle = (arr) => {
        for (let i = arr.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
      };
      const tail = cur.tracks.slice(cur.idx + 1);
      if (tail.length >= 2) {
        // Normal case: keep history + the playing track pinned, shuffle up-next.
        return { ...cur, tracks: [...cur.tracks.slice(0, cur.idx + 1), ...shuffle(tail)] };
      }
      // Tiny / end-of-queue set (e.g. just 2 tracks): nothing is strictly
      // "up next", so reorder the whole set while keeping the current track
      // playing — re-point idx at it so audio never restarts. Nudge until the
      // order actually changes so the shuffle is visible, not a silent no-op.
      const playing = cur.tracks[cur.idx];
      const original = cur.tracks;
      let tracks = shuffle([...original]);
      for (let n = 0; n < 6 && tracks.every((trk, i) => trk === original[i]); n++) {
        tracks = shuffle([...original]);
      }
      return { ...cur, tracks, idx: tracks.indexOf(playing) };
    });
    setShuffleActive(true);
    toast('shuffled.');
  };
  // Save the current queue (or featured pool if queue not yet promoted) as a
  // new playlist. Partial-failure tolerant — we don't roll back if some
  // addToPlaylist calls fail; user sees a "saved X of Y" toast.
  const saveQueueAsPlaylist = async () => {
    const tracksToSave = viewRef.current.tracks.length ? viewRef.current.tracks : pool;
    if (!tracksToSave.length) return;
    await prompt({
      title:       'save queue as playlist',
      body:        `${tracksToSave.length} ${tracksToSave.length === 1 ? 'track' : 'tracks'}`,
      placeholder: 'playlist name',
      submitLabel: 'save',
      cancelLabel: 'cancel',
      busyLabel:   (name) => `saving to ${name}`,
      // Runs with the dialog held open + the loader showing; owns its own toasts.
      onSubmit: async (name) => {
        try {
          const playlist = await createPlaylist({ name });
          const results = await Promise.allSettled(
            tracksToSave.map(tk => addToPlaylist(playlist.id, tk.id)),
          );
          const ok = results.filter(r => r.status === 'fulfilled').length;
          toast(ok === tracksToSave.length ? 'saved.' : `saved ${ok} of ${tracksToSave.length}.`);
        } catch (err) {
          toast("couldn't save.");
          console.warn('[save-queue]', err);
        }
      },
    });
  };

  // ── Hands-free voice (Car Mode) ───────────────────────────────────────
  // A spoken phrase → an action. Instant LOCAL commands (next/pause/louder/like…)
  // run immediately and offline; anything else is sent to the SAME /api/llm/talk
  // brain that powers typed TalkAura, which handles "play <song / vibe>". The mic
  // lives in the CarPlayer dashboard; voiceHint echoes the result back on-screen.
  // Instant LOCAL commands echo a short confirmation via flashHint (the 4s auto-clear
  // is fine — they're terminal). The slower "play <x>" → LLM path uses the richer
  // voiceStatus state machine below instead (a 4s clear would blank a slow request).
  const [voiceHint, setVoiceHint] = useState('');
  const voiceHintTimer = useRef(null);
  const flashHint = (msg) => {
    setVoiceHint(msg);
    clearTimeout(voiceHintTimer.current);
    voiceHintTimer.current = setTimeout(() => setVoiceHint(''), 4000);
  };

  // Voice-request lifecycle for the LLM path, surfaced as the Car Mode glance overlay.
  //   phase: 'idle' | 'listening' | 'thinking' | 'done' | 'error'
  //   text:  thinking → what the user asked for ("vaadi pulla vaadi", '' for a non-play
  //          query); error → the message.   title: done → the resolved song title.
  // Only the TERMINAL states (done/error) auto-fade; 'thinking' persists until talk()
  // settles — that's the fix for a request slower than the old 4s flashHint clear.
  const [voiceStatus, setVoiceStatus] = useState({ phase: 'idle', text: '', title: '' });
  const voiceFadeTimer = useRef(null);   // armed ONLY on terminal states
  const voiceReqId     = useRef(0);      // generation counter — newest press wins
  const voiceAbort     = useRef(null);   // AbortController for the in-flight talk()
  const clearVoiceFade = () => { clearTimeout(voiceFadeTimer.current); voiceFadeTimer.current = null; };
  const setVoiceTerminal = (next, ms) => {
    setVoiceStatus(next);
    clearVoiceFade();
    voiceFadeTimer.current = setTimeout(() => setVoiceStatus({ phase: 'idle', text: '', title: '' }), ms);
  };

  const runVoiceCommand = async (transcript) => {
    if (!transcript) return;
    const local = matchLocalIntent(transcript);
    if (local) {
      // A local command supersedes any overlay left by an in-flight "play x".
      clearVoiceFade();
      setVoiceStatus({ phase: 'idle', text: '', title: '' });
      const vol = player?.getVolume?.() ?? 1;
      switch (local.kind) {
        case 'next':    goNext();                                     flashHint('Next'); break;
        case 'prev':    goPrev();                                     flashHint('Previous'); break;
        case 'pause':   setPlaying(false);                            flashHint('Paused'); break;
        case 'play':    setPlaying(true);                             flashHint('Playing'); break;
        case 'louder':  player?.setVolume?.(Math.min(1, vol + 0.15)); flashHint('Louder'); break;
        case 'softer':  player?.setVolume?.(Math.max(0, vol - 0.15)); flashHint('Softer'); break;
        case 'mute':    player?.setMuted?.(true);                     flashHint('Muted'); break;
        case 'unmute':  player?.setMuted?.(false);                    flashHint('Unmuted'); break;
        case 'restart': player?.seek?.(0);                            flashHint('From the top'); break;
        case 'shuffle': shuffleQueue();                               flashHint('Shuffled'); break;
        case 'repeat':  cycleRepeat();                                flashHint('Repeat'); break;
        case 'like':    if (track?.id) { like(track.id).catch(() => {}); flashHint('Liked'); } break;
        default: break;
      }
      return;
    }
    // Not a local command → the LLM brain (same pipeline as typed TalkAura). Two layers
    // keep a re-press winning: useVoiceControl suppresses a stale result that was still
    // finalizing when you re-press; and here the AbortController + this generation guard
    // drop a turn whose network call is still in flight when the next turn starts.
    const myId = voiceReqId.current;
    const ctrl = new AbortController();
    voiceAbort.current = ctrl;
    clearVoiceFade();
    const stripped = stripRequestVerb(transcript);
    const hadVerb = !!stripped && stripped !== transcript.trim();
    setVoiceStatus({ phase: 'thinking', text: hadVerb ? stripped : '', title: '' });
    try {
      const { reply, tracks } = await talk({ message: transcript, signal: ctrl.signal });
      if (myId !== voiceReqId.current) return;   // a newer press superseded us
      if (tracks?.length) {
        pickLiveSequence(tracks, 0, 'voice command');
        const title = cleanTitle(tracks[0].title);
        setVoiceTerminal({ phase: 'done', text: '', title }, 2200);
        if (getSpokenConfirm()) speak(`Now playing ${title}`);
      } else {
        setVoiceTerminal({ phase: 'error', text: reply || 'No song matched.', title: '' }, 2600);
      }
    } catch (err) {
      if (err?.name === 'AbortError') return;     // superseded — the new turn owns the UI
      if (myId !== voiceReqId.current) return;
      setVoiceTerminal({ phase: 'error', text: 'Voice search failed.', title: '' }, 2600);
    }
  };
  const voice = useVoiceControl({ onResult: runVoiceCommand });

  // A new listen window always wins: cancel any in-flight request + stale speech and
  // bump the generation counter so a re-press immediately supersedes the previous turn.
  // Done in the press handler (not an effect) so there's no setState-in-effect cascade;
  // the 'listening' phase shows nothing in the overlay, so no end-side reset is needed.
  const beginVoiceTurn = () => {
    voiceAbort.current?.abort();
    voiceReqId.current++;
    stopSpeaking();
    clearVoiceFade();
    setVoiceStatus({ phase: 'listening', text: '', title: '' });
    voice.start();
  };

  // Teardown: a slow request must not resolve/speak after unmount.
  useEffect(() => () => {
    voiceAbort.current?.abort();
    clearTimeout(voiceFadeTimer.current);
    clearTimeout(voiceHintTimer.current);
    stopSpeaking();
  }, []);

  // The sleep sheet lives on its own bus, so it could stack with the why /
  // lyrics / crowd panels. Opening either side closes the other.
  const openOverlay = (name) => { closeSleepTimer(); setOverlay(name); };
  useEffect(() => subscribeSleepSheet((o) => { if (o) setOverlay(null); }), []);

  // Leave the player to another screen. Play the screen-out animation on
  // the player wrapper for a Telegram-style dismiss (scale + fade + slight
  // slide down). The previous diagonal art-to-orb morph was removed — it
  // looked like a regression on mobile where the orb isn't visible, so
  // the art flew to the top-left of the viewport for no clear reason.
  const leavePlayer = (nextScreen) => {
    if (!track) { setScreen(nextScreen); return; }
    // Mobile: the reverse of the open — morph the cover DOWN into the now-playing
    // bead while the drawer fades in place (no vaul slide). Needs the dock to show
    // at the destination so the bead exists to land on; otherwise (queue/overlay)
    // or under reduced motion, fall back to a plain close.
    if (isMobile) {
      const fromRect = getRect(document.getElementById('player-art'));
      const dockShows = nextScreen !== 'player' && nextScreen !== 'queue' && !overlay && !talkOpen;
      const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      if (!fromRect || fromRect.width <= 0 || !dockShows || reduce) { setScreen(nextScreen); return; }
      clearTimeout(morphTimer.current);
      cancelAnimationFrame(beginRaf.current);
      setClosingMorph(true);    // drawer fades in place (no vaul slide)
      setScreen(nextScreen);    // dock + bead mount behind the fading drawer
      const begin = (attempt = 0) => {
        const dock = document.querySelector('.aura-dock');
        const art = dock && dock.querySelector('.aura-dock__bead-art');
        if (!art && attempt < 6) { beginRaf.current = requestAnimationFrame(() => begin(attempt + 1)); return; }
        if (art) {
          // The bead plays its bud-in (scale) as the cover lands, so its live rect
          // is mid-scale. offsetLeft/Top/Width are LAYOUT metrics (ignore the
          // transform), so with the dock's un-animated viewport box they give the
          // bead-art's FINAL rect for the cover to settle onto.
          const d = dock.getBoundingClientRect();
          const bead = art.offsetParent || art.parentElement;
          const toRect = {
            left: d.left + (bead?.offsetLeft || 0) + art.offsetLeft,
            top:  d.top  + (bead?.offsetTop  || 0) + art.offsetTop,
            width: art.offsetWidth, height: art.offsetHeight,
            radius: 999, blur: 0,
          };
          // Collapse INTO the bead (the clip circle is full-screen this early, so
          // its centre doesn't bite until it shrinks — well after this lands).
          setBloomOrigin({ x: toRect.left + toRect.width / 2, y: toRect.top + toRect.height / 2 });
          setMorph({ track, fromRect: { ...fromRect, radius: 10, blur: 0 }, toRect, kind: 'close' });
        }
        morphTimer.current = setTimeout(() => {
          requestAnimationFrame(() => requestAnimationFrame(() => setMorph(null)));
          setClosingMorph(false);
        }, 470);
      };
      beginRaf.current = requestAnimationFrame(() => begin());
      return;
    }
    // Desktop/tablet: keep the routed player wrapper mounted for ~220 ms so its
    // screen-out animation (scale + fade + slide) can play out before it unmounts.
    clearTimeout(closingPlayerTimer.current);
    setClosingPlayer(true);
    setScreen(nextScreen);
    closingPlayerTimer.current = setTimeout(() => setClosingPlayer(false), 220);
  };
  // Open search (mobile: the top bar morphs into the field; desktop: the search
  // screen rises). Remember where we came from so closing returns there, and
  // arm the focus bus so the input focuses once the morph settles.
  const openSearch = () => {
    if (screen === 'search') return;
    // Cancel an in-flight close so a quick re-open doesn't run the exit animation.
    clearTimeout(closingSearchTimer.current);
    setClosingSearch(false);
    setSearchReturn(screen);
    setScreen('search');
    requestSearchFocus();
  };
  // Close mobile search: collapse the bar + sink the screen out together (320 ms),
  // clear the query, and return to wherever search was opened from.
  const closeSearch = () => {
    clearTimeout(closingSearchTimer.current);
    setClosingSearch(true);
    setSearchQuery('');
    setScreen(searchReturn);
    closingSearchTimer.current = setTimeout(() => setClosingSearch(false), 320);
  };
  const onNav = (target) => {
    setOverlay(null);
    // Direct nav resets player/queue back-stack — a fresh nav shouldn't
    // carry stale return state from a prior drill-down.
    setPlayerReturn('home');
    setQueueReturn('home');
    setJournalReturn('home');
    setDnaReturn('home');
    if (target === 'search') { openSearch(); return; }
    if (screen === 'player' && target !== 'player') leavePlayer(target);
    else setScreen(target);
  };

  if (screen === 'sensing') {
    return (
      <>
        <SensingScreen name={user?.name} djName={user?.djName || t.djName} mood={t.mood} onReady={() => setScreen(hasOnboarded() ? 'home' : 'onboarding')}/>
        <TweaksHost t={t} setTweak={setTweak}/>
      </>
    );
  }

  if (screen === 'onboarding') {
    // If the user originally landed on a deep link, route them there now that
    // they've cleared the gate. `#/player` without a queue still falls back to
    // home so they don't see an empty player.
    const postOnboardDest = (() => {
      const wanted = initialFromPath?.screen;
      if (!wanted) return 'home';
      // Gate screens are not real destinations — if the URL still reads
      // `#/onboarding` or `#/sensing` (the hash mirror wrote it on first
      // render), don't bounce the user back to themselves on submit.
      if (wanted === 'onboarding' || wanted === 'sensing') return 'home';
      if (wanted === 'player' && !queue.tracks.length) return 'home';
      return wanted;
    })();
    return (
      <>
        <OnboardingScreen pool={pool} onDone={() => setScreen(postOnboardDest)}/>
        {/* Rendered AFTER OnboardingScreen so it paints on top at the same
            z-index. OnboardingScreen has `position: fixed; inset: 0` and
            would cover the pill if the pill came first in DOM order. */}
        {isMobile && <MobileTopBar djName={t.djName} t={t} setTweak={setTweak} showAccount={false}/>}
        <TweaksHost t={t} setTweak={setTweak}/>
      </>
    );
  }

  // At compact (mobile + tablet-portrait), the player screen has no transport
  // controls of its own — the BottomMiniBar pill provides them. Keep it
  // visible on the player screen too (otherwise user is stuck with no way to
  // pause/skip until they back out). At desktop, the right rail handles
  // transport, so hide the (non-existent) mini there as before.
  const showMini = !overlay && (isDesktop ? screen !== 'player' : true);

  // Artist navigation — accepts either a string (artist name) from Home tiles
  // or a `{ id, name }` object from "fans also like" inside the artist screen.
  const onOpenArtist = (key) => {
    const k = typeof key === 'string' ? { name: key } : key;
    if (!k || (!k.id && !k.name)) return;
    setArtistKey(k);
    setArtistReturn(screen === 'artist' ? artistReturn : screen);
    setScreen('artist');
  };

  // Album / movie navigation — opens the detail screen, remembering where from.
  const onOpenAlbum = (id) => {
    if (!id) return;
    setAlbumId(id);
    setAlbumReturn(screen === 'album-detail' ? albumReturn : screen);
    setScreen('album-detail');
  };

  // Suspense fallback label mirrors what each screen's own loader says
  // once its chunk hydrates, so the user sees one continuous label across
  // the chunk-load → data-load handoff instead of two flickering ones.
  const skeletonLabel = screen === 'language-hub' && hubLang
    ? `Loading ${hubLang.charAt(0).toUpperCase()}${hubLang.slice(1)}`
    : (SCREEN_LABELS[screen] ?? 'Loading');

  // Bottom-chrome clearance for the mobile spacer (responsive.css ::after) and
  // the floating SpeedDial / SleepTimerOrb. The Mercury MobileDock keeps a near-
  // constant height (the now-playing bead buds off the capsule's left, within the
  // row), so it's only slightly taller with a track than idle (nav only).
  const bottomChrome = isMobile ? (track ? '92px' : '84px') : undefined;

  return (
    <>
      <NowPlayingElsewhere devices={othersPlaying}/>
      {resumeOffer && (
        <div className={`aura-npe ${othersPlaying.length > 0 ? 'aura-npe--resume' : ''}`} role="status">
          <span className="aura-npe__dot" aria-hidden="true"/>
          <span className="aura-npe__text">
            Pick up{resumeOffer.track?.title ? ` “${resumeOffer.track.title}”` : ''} from your other device?
          </span>
          <button type="button" className="aura-npe__action" onClick={acceptResume}>Resume</button>
          <button type="button" className="aura-npe__x" aria-label="Dismiss" onClick={() => setResumeOffer(null)}>×</button>
        </div>
      )}
      <div className="absolute inset-0 bg-bg text-ink overflow-hidden"
        style={bottomChrome ? { '--aura-bottom-chrome': bottomChrome } : undefined}>
        <Suspense fallback={<ScreenSkeleton label={skeletonLabel}/>}>
        {/* Unified screen dispatch — the Desktop* screens render at every
            breakpoint. PlaylistsScreen / OnboardingScreen / SensingScreen are
            the only mobile-specific screens still rendered as-is. */}
        {screen === 'home' && (
          <ScreenTransition key="home">
            <DesktopHome tracks={pool}
              loading={featured.status === 'loading'}
              djName={t.djName} currentTrackId={track?.id}
              track={track} onOpenPlayer={() => { setPlayerReturn(screen); setScreen('player'); }}
              activeMode={activeMode} modes={user?.modes} onSetMode={switchMode}
              onPick={pickById} onPickLive={pickLiveTrack} onPlaySequence={pickLiveSequence}
              onOpenJournal={() => { setJournalReturn('home'); setScreen('journal'); }}
              onOpenDna={() => { setDnaReturn('home'); setScreen('dna'); }}
              onOpenBridges={() => setScreen('bridges')}
              onOpenBridge={() => setScreen('bridges')}
              onOpenCatalogPlaylist={(id) => { setCatalogPlaylistId(id); setCatalogReturn('home'); setScreen('catalog-playlist-detail'); }}
              onOpenPlaylistDetail={(id) => { setDetailPlaylistId(id); setDetailReturn('home'); setScreen('playlist-detail'); }}
              onOpenAuto={(auto) => { setAutoPlaylist(auto); setAutoReturn('home'); setScreen('auto-playlist-detail'); }}
              onOpenPlaylists={() => setScreen('playlists')}
              onOpenSearch={openSearch}
              onOpenArtist={onOpenArtist}
              t={t} setTweak={setTweak}/>
          </ScreenTransition>
        )}
        {/* Phone now-playing: a full-height vaul drawer you pull DOWN to minimise
            back to the mini bar. `screen === 'player'` stays the source of truth;
            the drawer is rendered whenever a track exists so vaul can animate the
            slide-out on dismiss. */}
        {isMobile && track && (
          <PlayerDrawer open={screen === 'player'} instant={instantPlayer} closing={closingMorph && screen !== 'player'} bloomOrigin={bloomOrigin} onClose={() => leavePlayer(playerReturn)}>
            {activeMode === 'car' ? (
              <CarPlayer
                track={track} progress={progress} playing={playing}
                onTogglePlay={() => setPlaying(p => !p)} onNext={goNext} onPrev={goPrev}
                onSeek={(p) => player.seek(p)}
                onBack={() => leavePlayer(playerReturn)}
                djName={t.djName}
                voiceSupported={voice.supported} voiceListening={voice.listening}
                onTalkStart={beginVoiceTurn} onTalkEnd={voice.stop}
                voiceHint={voiceHint} voiceStatus={voiceStatus}/>
            ) : (
              <MobilePlayer
                open={screen === 'player'}
                track={track} progress={progress} playing={playing}
                nextTrack={next ?? (autoNextDisplay?.seedId === track.id ? autoNextDisplay.candidates[0] : null)}
                nextLoading={autoNextLoading}
                mood={t.mood} djName={t.djName}
                repeatMode={repeatMode} onCycleRepeat={cycleRepeat}
                onShuffle={shuffleQueue} shuffleActive={shuffleActive}
                onTogglePlay={() => setPlaying(p => !p)} onNext={goNext} onPrev={goPrev}
                onSeek={(p) => player.seek(p)} player={player}
                onBack={() => leavePlayer(playerReturn)}
                openWhy={() => openOverlay('why')} openLyrics={() => openOverlay('lyrics')}
                openQueue={() => { setQueueReturn('player'); setScreen('queue'); }}/>
            )}
          </PlayerDrawer>
        )}
        {/* Desktop / tablet now-playing: full-screen route with screen-out anim. */}
        {!isMobile && (screen === 'player' || closingPlayer) && track && (
          <ScreenTransition key="player" out={closingPlayer}>
            <DesktopPlayer
              track={track} nextTrack={next} progress={progress} audioTime={audioTime} playing={playing}
              mood={t.mood} djName={t.djName} player={player}
              repeatMode={repeatMode} onCycleRepeat={cycleRepeat}
              onShuffle={shuffleQueue} shuffleActive={shuffleActive}
              onTogglePlay={() => setPlaying(p => !p)} onNext={goNext} onPrev={goPrev}
              onSeek={(p) => player.seek(p)}
              onBack={() => leavePlayer(playerReturn)}
              openWhy={() => openOverlay('why')} openLyrics={() => openOverlay('lyrics')}
              openQueue={() => { setQueueReturn('player'); setScreen('queue'); }}
              showRelated={!isDesktop || isTabletLandscape}
              onPickLive={pickLiveTrack} onPlayNext={enqueueNext} onAddToQueue={enqueueLast}/>
          </ScreenTransition>
        )}
        {screen === 'queue' && (
          <ScreenTransition key="queue">
            <DesktopQueue tracks={viewTracks} currentIdx={viewIdx} source={viewSource} djName={t.djName}
              onPick={pickFromQueue} onClose={() => setScreen(queueReturn)} onRemove={removeFromQueue}
              onReorder={reorderQueue} onPlayNext={enqueueNext} onAddToQueue={enqueueLast}
              onClear={clearQueue} onShuffle={shuffleQueue} shuffleActive={shuffleActive} onSave={saveQueueAsPlaylist}
              repeatMode={repeatMode} onCycleRepeat={cycleRepeat}
              autoNextBatch={autoNextDisplay?.candidates ?? null}
              onPlayAutoNext={(offset = 0) => {
                const auto = consumeAutoNext(viewRef.current, offset);
                if (auto) { setQueue(auto); setPlaying(true); }
              }}/>
          </ScreenTransition>
        )}
        {(screen === 'search' || closingSearch) && (
          <ScreenTransition key="search" noEnter={isMobile} className={isMobile ? `aura-search-screen ${closingSearch ? 'aura-search-screen--closing' : ''}` : ''}>
            <DesktopSearch djName={t.djName} onClose={() => setScreen('home')} headerless={isMobile}
              familyMode={explicitOff}
              onPickLive={pickLiveTrack}
              onPlayNext={enqueueNext} onAddToQueue={enqueueLast}
              onOpenArtist={onOpenArtist}
              onOpenAlbum={onOpenAlbum}
              onOpenCatalogPlaylist={(id) => { setCatalogPlaylistId(id); setCatalogReturn('search'); setScreen('catalog-playlist-detail'); }}
              onOpenPlaylist={(id) => { setDetailPlaylistId(id); setDetailReturn('search'); setScreen('playlist-detail'); }}/>
          </ScreenTransition>
        )}
        {screen === 'talk' && (
          <ScreenTransition key="talk">
            <DesktopTalk djName={t.djName} mood={t.mood} onPickSequence={pickLiveSequence}
              track={track} onOpenPlayer={() => { setPlayerReturn(screen); setScreen('player'); }}/>
          </ScreenTransition>
        )}
        {screen === 'library' && (
          <ScreenTransition key="library">
            <DesktopLibrary
              onOpenPlaylists={() => setScreen('playlists')}
              onPlaySequence={pickLiveSequence}
              onPickLive={pickLiveTrack}
              onPlayNext={enqueueNext}
              onAddToQueue={enqueueLast}
              onOpenLiked={() => setScreen('liked')}
              onOpenHistory={() => setScreen('history')}
              onOpenPlaylistDetail={(id) => { setDetailPlaylistId(id); setDetailReturn('library'); setScreen('playlist-detail'); }}
              onOpenLangHub={(L) => { setHubLang(L); setScreen('language-hub'); }}
              onOpenJournal={() => { setJournalReturn('library'); setScreen('journal'); }}
              onOpenDna={() => { setDnaReturn('library'); setScreen('dna'); }}
              t={t} setTweak={setTweak}/>
          </ScreenTransition>
        )}
        {screen === 'liked' && (
          <ScreenTransition key="liked">
            <DesktopLiked onClose={() => setScreen('library')}
              onPlaySequence={pickLiveSequence} onPickLive={pickLiveTrack} onPlayOne={pickLiveTrack}
              onPlayNext={enqueueNext} onAddToQueue={enqueueLast}/>
          </ScreenTransition>
        )}
        {screen === 'history' && (
          <ScreenTransition key="history">
            <DesktopHistory onClose={() => setScreen('library')}
              onPickLive={pickLiveTrack} onPlayNext={enqueueNext} onAddToQueue={enqueueLast}/>
          </ScreenTransition>
        )}
        {screen === 'playlists' && (
          <ScreenTransition key="playlists">
            <PlaylistsScreen onClose={() => setScreen('library')}
              onPlaySequence={pickLiveSequence}
              onOpenAuto={(auto) => { setAutoPlaylist(auto); setAutoReturn('playlists'); setScreen('auto-playlist-detail'); }}
              onOpenPlaylist={(id) => { setDetailPlaylistId(id); setDetailReturn('playlists'); setScreen('playlist-detail'); }}/>
          </ScreenTransition>
        )}
        {screen === 'playlist-detail' && detailPlaylistId && (
          <ScreenTransition key={`pl-${detailPlaylistId}`}>
            <DesktopPlaylistDetail playlistId={detailPlaylistId}
              onClose={() => setScreen(detailReturn)} onPlaySequence={pickLiveSequence}
              onPlayOne={pickLiveTrack} onPlayNext={enqueueNext} onAddToQueue={enqueueLast}/>
          </ScreenTransition>
        )}
        {screen === 'catalog-playlist-detail' && catalogPlaylistId && (
          <ScreenTransition key={`cat-${catalogPlaylistId}`}>
            <DesktopCatalogPlaylistDetail playlistId={catalogPlaylistId}
              onClose={() => setScreen(catalogReturn)} onPlaySequence={pickLiveSequence}
              onPlayOne={pickLiveTrack} onPlayNext={enqueueNext} onAddToQueue={enqueueLast}/>
          </ScreenTransition>
        )}
        {screen === 'auto-playlist-detail' && autoPlaylist && (
          <ScreenTransition key={`auto-${autoPlaylist.id}`}>
            <DesktopCatalogPlaylistDetail playlistId={autoPlaylist.id} initialData={autoPlaylist}
              onClose={() => setScreen(autoReturn)} onPlaySequence={pickLiveSequence}
              onPlayOne={pickLiveTrack} onPlayNext={enqueueNext} onAddToQueue={enqueueLast}/>
          </ScreenTransition>
        )}
        {screen === 'shared-playlist' && sharedPlaylist && (
          <ScreenTransition key={`shared-${sharedPlaylist.id}`}>
            <DesktopCatalogPlaylistDetail playlistId={sharedPlaylist.id} initialData={sharedPlaylist}
              ownerName={sharedPlaylist.ownerName}
              onClose={() => setScreen(sharedReturn)} onPlaySequence={pickLiveSequence}
              onPlayOne={pickLiveTrack} onPlayNext={enqueueNext} onAddToQueue={enqueueLast}/>
          </ScreenTransition>
        )}
        {screen === 'album-detail' && albumId && (
          <ScreenTransition key={`al-${albumId}`}>
            <DesktopAlbumDetail albumId={albumId}
              onClose={() => setScreen(albumReturn)} onPlaySequence={pickLiveSequence}
              onPlayOne={pickLiveTrack} onPlayNext={enqueueNext} onAddToQueue={enqueueLast}/>
          </ScreenTransition>
        )}
        {screen === 'language-hub' && hubLang && (
          <ScreenTransition key={`hub-${hubLang}`}>
            <DesktopLanguageHub lang={hubLang}
              onClose={() => setScreen('home')} onPickLive={pickLiveTrack}
              onOpenCatalogPlaylist={(id) => { setCatalogPlaylistId(id); setCatalogReturn('language-hub'); setScreen('catalog-playlist-detail'); }}/>
          </ScreenTransition>
        )}
        {screen === 'artist' && artistKey && (
          <ScreenTransition key={`ar-${artistKey.id || artistKey.name}`}>
            <DesktopArtist artistKey={artistKey}
              onClose={() => setScreen(artistReturn)}
              onPickLive={pickLiveTrack}
              onPlaySequence={pickLiveSequence}
              onPlayNext={enqueueNext}
              onAddToQueue={enqueueLast}
              onOpenArtist={onOpenArtist}
              onOpenAlbum={onOpenAlbum}/>
          </ScreenTransition>
        )}

        {/* Shared-element morph layer — sits above screens so source/target are covered cleanly */}
        {morph && <MorphLayer {...morph}/>}
        {screen === 'journal' && (
          <ScreenTransition key="journal">
            <DesktopJournal djName={t.djName} onPickLive={pickLiveTrack} onClose={() => setScreen(journalReturn)}/>
          </ScreenTransition>
        )}
        {screen === 'dna' && (
          <ScreenTransition key="dna">
            <DesktopDna onClose={() => setScreen(dnaReturn)}/>
          </ScreenTransition>
        )}
        {screen === 'bridges' && (
          <ScreenTransition key="bridges">
            <DesktopBridges onPickSequence={pickLiveSequence}/>
          </ScreenTransition>
        )}
        </Suspense>

        {overlay === 'why'    && track && <WhyPanel     track={track} mood={t.mood} djName={t.djName} onClose={() => setOverlay(null)}/>}
        {(overlay === 'lyrics' || closingLyrics) && track && (
          <LyricsScreen
            track={track}
            audioTime={audioTime}
            playing={playing}
            ended={ended}
            onSeekToTime={(sec) => { const d = player.getDurationSec(); if (d > 0) player.seek(sec / d); }}
            closing={closingLyrics}
            onClose={() => {
              if (closingLyrics) return;
              clearTimeout(closingLyricsTimer.current);
              setClosingLyrics(true);
              closingLyricsTimer.current = setTimeout(() => {
                setOverlay(null);
                setClosingLyrics(false);
              }, 220);
            }}
          />
        )}
        {overlay === 'crowd'  && track && <CrowdScreen  track={track} mood={t.mood} onClose={() => setOverlay(null)}/>}

        {/* Mobile chrome: MobileTopBar (brand + theme) at the top; MobileDock — a
            glass nav capsule (home/search/talk/you) with a now-playing bead that
            buds off its left end when a track is loaded + the back-to-top morph
            — at the bottom. Both hide on the player screen so DesktopPlayer's
            floating back / ⋯ buttons aren't covered and the page swiper claims
            the full surface. */}
        {isMobile && !overlay && !talkOpen && screen !== 'player' && <MobileTopBar djName={t.djName} t={t} setTweak={setTweak}
          onOpenProfile={() => onNav('library')}
          activeMode={activeMode} modes={user?.modes} onSetMode={switchMode} loading={featured.status === 'loading'}
          onOpenSearch={openSearch} searching={screen === 'search'} onCloseSearch={closeSearch}/>}
        {isMobile && !overlay && !talkOpen && screen !== 'player' && <MobileDock
          track={track} playing={playing} progress={progress}
          onTogglePlay={() => setPlaying(p => !p)}
          onOpenPlayer={(el) => morphInto(track, el, () => { setPlayerReturn(screen); setScreen('player'); })}
          active={screen} onNav={onNav} onTalk={() => setTalkOpen(true)}
          mode={barScrolled ? 'backtotop' : 'bar'} onBackToTop={scrollActiveUp}/>}
        {/* Tablet-portrait chrome: TopNavStrip top + BottomMiniBar bottom.
            NavRail + DesktopRail are desktop-only. */}
        {isTabletPortrait && <TopNavStrip djName={t.djName} active={screen} onNav={onNav}
          onTalk={() => setTalkOpen(true)} t={t} setTweak={setTweak}/>}
        {isTabletPortrait && showMini && !morph && <BottomMiniBar track={track} progress={progress} playing={playing} player={player}
          onTogglePlay={() => setPlaying(p => !p)} onPrev={goPrev} onNext={goNext}
          onOpenPlayer={() => { setPlayerReturn(screen); setScreen('player'); }}/>}
        {isDesktop && <NavRail djName={t.djName} mood={t.mood} active={screen}
          onNav={onNav}
          collapsed={isTabletLandscape ? true : navCollapsed}
          onToggle={isTabletLandscape ? undefined : toggleNav}/>}
        {isDesktop && (
          <DesktopRail
            track={track} nextTrack={next} progress={progress} playing={playing} player={player}
            collapsed={railCollapsed} onToggle={toggleRail}
            slim={isTabletLandscape}
            onTogglePlay={() => setPlaying(p => !p)} onPrev={goPrev} onNext={goNext}
            onSeek={(p) => player.seek(p)}
            onOpenLyrics={() => openOverlay('lyrics')} onOpenWhy={() => openOverlay('why')}
            onOpenQueue={() => { setOverlay(null); setQueueReturn(screen); setScreen('queue'); }}
            onPickLive={pickLiveTrack}
            onPlayNext={enqueueNext}
            onAddToQueue={enqueueLast}
            repeatMode={repeatMode} onCycleRepeat={cycleRepeat}
            onShuffle={shuffleQueue} shuffleActive={shuffleActive}/>
        )}
        {isDesktop && railCollapsed && track && (
          <FloatingMini track={track} playing={playing} player={player}
            onTogglePlay={() => setPlaying(p => !p)} onPrev={goPrev} onNext={goNext}
            onOpenPlayer={() => { setPlayerReturn(screen); setScreen('player'); }}
            onExpandRail={() => setRailCollapsed(false)}/>
        )}
        {/* TalkAura modal still triggered by compact chrome's onTalk; will be
            unified into the screen='talk' route in a later phase. */}
        {isCompact && talkOpen && <TalkAura djName={t.djName} mood={t.mood}
          onClose={() => setTalkOpen(false)} onPickSequence={pickLiveSequence}
          track={track} onOpenPlayer={() => { setTalkOpen(false); setPlayerReturn(screen); setScreen('player'); }}
          t={t} setTweak={setTweak}/>}
        <Toast/>
        <AddToPlaylistSheet/>
        <GooFilter/>
        <TapRipple/>
        <ConfirmDialog/>
        <PromptDialog/>
        <WhatsNewSheet/>
        <ShortcutsOverlay/>
        {tourActive && (
          <Suspense fallback={null}>
            <SiteTour surface={isMobile ? 'mobile' : 'desktop'} screen={screen}
              onNav={onNav} onClose={() => setTourActive(false)}/>
          </Suspense>
        )}
        <SleepTimerSheet/>
        <SleepTimerOrb railCollapsed={railCollapsed} isDesktop={isDesktop}/>
        {/* Quick-action speed dial — compact surfaces only (desktop has the
            rails). Hidden over the player drawer / overlays / talk, and on the
            queue (its own toolbar — save/shuffle/clear + per-row menus — covers
            these, so the floating dial there is redundant clutter). */}
        {isCompact && !overlay && !talkOpen && screen !== 'player' && screen !== 'queue' && (
          <SpeedDial actions={[
            { id: 'why', label: 'why this song', show: !!track,
              onClick: () => openOverlay('why'),
              icon: (<svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M7 7.5 a3 3 0 1 1 4 2.8 c-.8 .4 -1 .9 -1 1.7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/><circle cx="10" cy="15" r="0.9" fill="currentColor"/></svg>) },
            { id: 'playlist', label: 'save to playlist', show: !!track,
              onClick: () => openAddToPlaylist(track),
              icon: (<svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M3 6 H13 M3 10 H10 M3 14 H10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/><circle cx="15" cy="14" r="3.6" stroke="currentColor" strokeWidth="1.4"/><path d="M15 12.4 V15.6 M13.4 14 H16.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/></svg>) },
            { id: 'surprise', label: 'surprise me', show: pool.length > 0,
              onClick: () => { const r = pool[Math.floor(Math.random() * pool.length)]; if (r) pickLiveTrack(r); },
              icon: (<svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M10 2.5 L11.4 7.6 L16.5 9 L11.4 10.4 L10 15.5 L8.6 10.4 L3.5 9 L8.6 7.6 Z" fill="currentColor"/></svg>) },
            { id: 'sleep', label: 'sleep timer', onClick: openSleepTimer,
              icon: (<svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M16 12.5 A6.5 6.5 0 1 1 7.5 4 A5.5 5.5 0 0 0 16 12.5 Z" fill="currentColor"/></svg>) },
          ]}/>
        )}
        {/* All surfaces: right-click on desktop, long-press on phones (ctxPress). */}
        <TrackContextMenu
          onPickLive={pickLiveTrack}
          onPlayNext={enqueueNext}
          onAddToQueue={enqueueLast}
          onOpenArtist={onOpenArtist}/>
      </div>
      <TweaksHost t={t} setTweak={setTweak}/>
    </>
  );
}

function readStoredTheme() {
  try {
    const v = localStorage.getItem('aura.theme');
    if (v === 'dusk' || v === 'midnight' || v === 'bloom') return v;
  } catch { /* localStorage disabled */ }
  return null;
}

function readStoredRepeat() {
  try {
    const v = localStorage.getItem('aura.repeat');
    if (v === 'off' || v === 'all' || v === 'one') return v;
  } catch { /* localStorage disabled */ }
  return 'off';
}

export function Root({ user } = {}) {
  const storedTheme = useMemo(() => readStoredTheme(), []);
  // Seed initial tweaks from the stored theme and the authed user's saved DJ
  // name. useTweaks only reads this on mount, which is correct — the user is
  // already resolved by the time the app view renders.
  const [t, setTweak] = useTweaks({
    ...DEFAULT_TWEAKS,
    ...(storedTheme ? { theme: storedTheme } : {}),
    ...(user?.djName ? { djName: user.djName } : {}),
  });
  const theme = THEMES[t.theme] || THEMES.dusk;
  // A phone held in landscape keeps the PORTRAIT mobile layout mounted (so
  // audio, queue and screen state survive the rotation) and gets the rotate
  // prompt painted over everything — see classifyViewport in useViewport.js.
  const { breakpoint: rawBreakpoint, phoneLandscape } = useViewport();
  const breakpoint = phoneLandscape ? 'mobile' : rawBreakpoint;
  const rails = useRailToggles();
  // Skip the initial write — the value already matches whatever
  // readStoredTheme() returned (or the default for fresh users).
  const themeMounted = useRef(false);
  useEffect(() => {
    if (!themeMounted.current) { themeMounted.current = true; return; }
    try { localStorage.setItem('aura.theme', t.theme); } catch { /* ignore */ }
  }, [t.theme]);
  // Sync body background to the theme so the responsive shell never reveals a
  // mismatched edge color during reflows / reduced-motion view transitions.
  useEffect(() => {
    document.body.style.background = theme.bg;
  }, [theme.bg]);
  // Mirror the theme class onto <html> so popovers / sheets that portal to
  // document.body (queue ⋯, mlt ⋯, etc.) still match the `.theme-midnight
  // .selector` descendant rules — they're siblings of the App root, not
  // descendants, so they'd otherwise resolve to the :root dusk defaults.
  useEffect(() => {
    const html = document.documentElement;
    html.classList.remove('theme-dusk', 'theme-midnight', 'theme-bloom');
    html.classList.add(`theme-${t.theme}`);
  }, [t.theme]);

  const content = (
    <div className={`theme-${t.theme} absolute inset-0`}>
      <App t={t} setTweak={setTweak} breakpoint={breakpoint} rails={rails}/>
    </div>
  );

  // Portal the responsive shell to body so position:fixed inside it is sized
  // relative to the viewport, not the React mount node. Every breakpoint
  // (mobile through large-desktop) flows through this single path.
  const isDesktop         = isDesktopBreakpoint(breakpoint);
  const isMobile          = breakpoint === 'mobile';
  const isTabletLandscape = breakpoint === 'tablet-landscape';
  const isTabletPortrait  = breakpoint === 'tablet-portrait';
  const isDesktopReal     = isDesktop && !isTabletLandscape;
  return createPortal(
    <div className={[
      'aura-responsive-shell',
      `theme-${t.theme}`,
      isMobile          ? 'aura-responsive-shell--mobile' : '',
      isDesktopReal     ? 'aura-responsive-shell--desktop' : '',
      isTabletLandscape ? 'aura-responsive-shell--tablet-landscape' : '',
      isTabletPortrait  ? 'aura-responsive-shell--tablet-portrait'  : '',
      isDesktopReal     && rails.navCollapsed  ? 'aura-shell--nav-collapsed'  : '',
      (isDesktopReal || isTabletLandscape) && rails.railCollapsed ? 'aura-shell--rail-collapsed' : '',
    ].filter(Boolean).join(' ')}>
      <div className="aura-responsive-shell__stage">{content}</div>
      {phoneLandscape && <RotateOverlay/>}
    </div>,
    document.body,
  );
}
