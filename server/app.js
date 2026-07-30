import express from 'express';
import cookieParser from 'cookie-parser';
import { rateLimit, ipKeyGenerator } from 'express-rate-limit';
import { makeRateStore } from './rateLimitStore.js';
import { pool, query } from './db.js';
import { searchSongs, searchSuggest, rankByLang } from './catalog.js';
import { getTrackById, cacheTracks } from './tracks.js';
import { getFeatured } from './featured.js';
import { getLyricsForTrack } from './lyrics.js';
import {
  generationEnabled, saveLyrics, enqueueLyricJob, dispatchJob,
  completeFromPrediction, processQueue, reserveUserGenSlot,
} from './lyricsJobs.js';
import { recordLyricsMetric, getLyricsStats } from './lyricsMetrics.js';
import { LYRICS_WEBHOOK_SECRET, REPLICATE_WEBHOOK_SIGNING_SECRET, CRON_SECRET } from './config.js';
import { verifyWebhookSignature } from './replicateWebhook.js';
import { safeCompare } from './safeCompare.js';
import { generateWhy } from './prompts/why.js';
import { getJournalEntries } from './journal.js';
import { getSonicDna } from './sonicDna.js';
import { listLiked, listLikedIds, likeTrack, unlikeTrack } from './likes.js';
import { listPlaylists, getPlaylist, getPlaylistRev, createPlaylist, deletePlaylist, addTrackToPlaylist, removeTrackFromPlaylist, searchPlaylists, createInvite, acceptInvite, removeCollaborator, setPlaylistVisibility, setPlaylistOnlyMe, setPlaylistCover, savePlaylist, unsavePlaylist, listSavedPlaylists, getPublicPlaylist } from './playlists.js';
import { getLibrarySummary } from './library.js';
import { recordHeartbeat, getNowPlaying, getResume } from './playback.js';
import { getLoudness, loudnessMeasureHandler } from './loudness.js';
import { stemsRequestHandler } from './stems.js';
import { getGreeting } from './greeting.js';
import { getMostPlayed, getTopArtists, getRecentlyPlayed, getHistory, getMusicClockPlays } from './stats.js';
import { getQuickPicks } from './quickPicks.js';
import { getPersonalHero, getNewForYou, getStations } from './homeReco.js';
import { recordImpressions, pruneOldImpressions } from './impressions.js';
import { uploadImage } from './uploads.js';
import { getAutoPlaylists, refreshDueMixes } from './autoPlaylists.js';
import { hideTrack, unhideTrack, listHidden } from './hiddenTracks.js';
import { getDiscoverHome } from './discover.js';
import { getCatalogPlaylistDetail } from './catalog.js';
import { getBridgeTracks, getBridgeSuggestion } from './bridges.js';
import { getRelatedTracks, demoteSkipped } from './related.js';
import { getArtistDetails, getAlbumDetail } from './artists.js';
import { generateTalk, sanitizeSuggestions } from './prompts/talk.js';
import { inferIfStale, refreshMood } from './mood.js';
import { buildTalkContext } from './context.js';
import { normalizeMood } from './moods.js';
import authRouter from './auth.js';
import familyRouter from './family.js';
import modesRouter from './modesRoutes.js';
import { modeSeedArtists, modeSeedTracks } from './modes.js';
import { requireAuth, optionalAuth, peekUserId, sweepSessions } from './middleware/auth.js';
import { getPrefs, sendToUser, prunePushLog } from './push.js';
import { allowedArtUrl, fetchArt, renderCardPng } from './cardArt.js';
import { notifyMixesReady, notifyTrackAdded, notifyInviteAccepted, sweepNudges } from './notify.js';
import { recordNotification, listNotifications, markNotificationsSeen } from './notifications.js';
import { isAdminEmail } from './adminGate.js';
import { asyncHandler, clientError, errorMiddleware, notFound } from './middleware/errors.js';
import { isId, clampInt } from './validate.js';

// The configured Express app, with NO side effects at import time: it neither
// connects/migrates the database nor starts a listener. The local dev entry
// (server/index.js) bootstraps the DB then calls app.listen(); the Vercel
// serverless entry (api/[...path].js) imports this app and lets the platform
// invoke it per request.
const app = express();
// Body parsing that's robust to the host pre-parsing the request. Locally (and
// on hosts that don't touch the body) req.body is undefined, so express.json()
// reads the stream as usual. On serverless runtimes that may already parse JSON
// bodies, reading the stream again would hang or return empty — so if a parsed
// object is already present, use it as-is.
app.use((req, res, next) => {
  // The Replicate webhook posts a large prediction payload (the full WhisperX
  // output) — it has its own higher-limit parser on the route, so skip the
  // 64kb guard here for that path only.
  if (req.path === '/api/lyrics-jobs/webhook') return next();
  // Image uploads send a raw (non-JSON) body parsed on the route itself — skip
  // both the JSON parser and the 64kb guard here (the route caps size).
  if (req.path === '/api/uploads/image') return next();
  // Enforce the size ceiling from Content-Length too: the express.json limit
  // below is skipped when the platform pre-parsed the body (exactly the
  // serverless case it's meant to protect), so guard here unconditionally. (#18)
  if (Number(req.headers['content-length']) > 64 * 1024) {
    return res.status(413).json({ error: 'request too large' });
  }
  if (req.body && typeof req.body === 'object') return next();
  express.json({ limit: '64kb' })(req, res, next);
});

// Parse cookies so requireAuth can read the httpOnly session cookie. (security: M2)
app.use(cookieParser());

// Deadline for fetching our own built SPA shell when injecting Open Graph
// tags for /p/ and /t/ links. Separate from catalog.js's UPSTREAM_TIMEOUT_MS:
// that one bounds a third party, this bounds a static asset on our own CDN.
const SHELL_FETCH_TIMEOUT_MS = 5_000;

// ── Rate limiting ───────────────────────────────────────────────────
// Behind Vercel's edge (a single proxy) — trust ONE hop so req.ip is the real
// client for per-IP limiting. NOT `true`, which would let clients spoof
// X-Forwarded-For. Locally there's no proxy header so req.ip is the socket addr.
app.set('trust proxy', 1);

// A prefix opts a limiter into the Upstash shared store (global across serverless
// instances); without one (or when Upstash isn't configured) it uses the
// in-memory default. (security: #4)
function buildLimiter(windowMs, limit, message, prefix, keyGenerator) {
  const base = { windowMs, limit, standardHeaders: true, legacyHeaders: false, message: { error: message } };
  if (keyGenerator) base.keyGenerator = keyGenerator;
  const store = prefix ? makeRateStore(prefix) : undefined;
  return rateLimit(store ? { ...base, store } : base);
}
// Cost routes are keyed by ACCOUNT when signed in (else per-IP) so one account
// can't multiply its paid-LLM budget across many IPs/devices — the per-IP key let
// a shared/leaked account drive N× the spend. peekUserId only verifies the token
// signature (no DB), so this stays cheap on the hot path. (security: per-account cost)
export const accountOrIpKey = (req) => {
  const uid = peekUserId(req);
  if (uid) return `u:${uid}`;
  return req.ip ? ipKeyGenerator(req.ip) : 'ip:unknown';
};
// Broad catch-all so one IP can't flood the API. Stays IN-MEMORY: it fires on
// every /api request, so a shared-store round-trip here would tax the hot path;
// per-instance flood-guarding is fine for this.
const generalLimiter = buildLimiter(5 * 60 * 1000, 600, 'too many requests — slow down a moment.');
// Tight on auth to blunt credential brute-force + OTP abuse — SHARED store so the
// limit is global across instances (complements the per-account lockout).
const authLimiter = buildLimiter(15 * 60 * 1000, 40, 'too many attempts — try again in a few minutes.', 'auth');
// Protects the unauthenticated, cost-bearing routes (Gemini, lyrics, upstream)
// from spend/DoS on cache misses — SHARED store, global across instances.
const costLimiter = buildLimiter(5 * 60 * 1000, 60, 'too many requests — slow down a moment.', 'cost', accountOrIpKey);
// Sensitive per-account actions (family PIN, mode switches) — SHARED store, keyed by
// account (else IP), layered on top of the routes' own per-account PIN lockouts.
const sensitiveLimiter = buildLimiter(15 * 60 * 1000, 40, 'too many requests — slow down a moment.', 'sensitive', accountOrIpKey);
// Stems separation — the costliest cache-miss on the API: a finite MVSEP
// free-tier job plus a persistent, billable Blob write per track. Account-keyed
// and SHARED (global across instances) so a single account can't script the
// endpoint to drain the shared MVSEP quota or spray junk rows. Sized for the
// POLL cadence, not taps: while "preparing…" the client re-asks every 20s
// (≈30 calls/10min) and free-queue separation takes minutes — the old cap of
// 20 starved a single honest wait into 429s ("couldn't reach the server").
// 60 covers a full wait plus a second track; the costly steps stay gated by
// the state machine's single job slot and per-track try cap regardless.
const stemsLimiter = buildLimiter(10 * 60 * 1000, 60, 'too many requests — slow down a moment.', 'stems', accountOrIpKey);

app.use('/api', generalLimiter);
app.use('/api/auth', authLimiter);
// Cost-bearing routes (Gemini / lyrics provider / Replicate / upstream catalog).
// Tighter than the broad generalLimiter so cache-miss spend can't be driven.
// (security: H1 / M4 / M5)
app.use(['/api/why', '/api/lyrics', '/api/greeting', '/api/mood', '/api/llm'], costLimiter);
// Sensitive per-account routes get a tighter, shared, account-keyed limiter on top
// of generalLimiter — registered before their routers mount below.
app.use(['/api/family', '/api/modes'], sensitiveLimiter);
// Stems is cost-bearing (MVSEP quota + Blob) — account-keyed, tighter than general.
app.use('/api/stems', stemsLimiter);

// ── Auth routes (public) ────────────────────────────────────────────
app.use('/api/auth', authRouter);

// ── Family mode (all routes require auth) ────────────────────────────
app.use('/api/family', familyRouter);

// ── Listening modes (all routes require auth) ────────────────────────
app.use('/api/modes', modesRouter);

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

// One net under every app-level route that takes an opaque id in the path:
// junk is rejected before it can reach a handler, a SQL bind, or (worst) an
// upstream relay. Handlers with stricter inline checks still run them — this
// is the floor, not the ceiling. publicId is deliberately NOT here: /p/:publicId
// must keep serving the generic share card for malformed links, never a JSON 400.
// (security: input caps)
for (const param of ['id', 'track_id', 'user_id', 'token']) {
  app.param(param, (req, res, next, val) => {
    if (!isId(val)) return res.status(400).json({ error: 'invalid id' });
    next();
  });
}

// asyncHandler, not an inline try/catch: this is the one route in this file
// with no error guard at all. Its awaits are all Promise.allSettled so nothing
// escapes there, but ~50 lines of ranking and mapping follow, and a throw in
// an unguarded async handler is NOT forwarded by Express 4 — it becomes an
// unhandled rejection that processGuards logs while the client waits out the
// full 60s function timeout with no response. (#26)
app.get('/api/catalog/search', optionalAuth, asyncHandler(async (req, res) => {
  // Bounded before anything reaches the upstream catalog: query text capped,
  // limit clamped, language list capped. (security: input caps)
  const q = String(req.query.q ?? '').trim().slice(0, 200);
  if (!q) return res.status(400).json({ error: 'missing query' });
  const lang = req.query.lang ? String(req.query.lang).slice(0, 40) : undefined;
  const limit = clampInt(req.query.limit, 20, 1, 40);
  // The user's languages, in priority order, for "my-languages-first" ranking.
  const userLangs = req.query.langs
    ? String(req.query.langs).split(',').map(s => s.trim().toLowerCase()).filter(Boolean).slice(0, 10)
    : [];
  // Songs come from the rich song search; albums/movies/playlists + the best
  // match from the suggest endpoint; user playlists from our DB. All in parallel
  // — suggest + user playlists are supplementary, so only a failed song search
  // surfaces as an error.
  const [songsRes, sugRes, plRes] = await Promise.allSettled([
    searchSongs(q, { lang, limit }),
    searchSuggest(q),
    req.userId ? searchPlaylists(req.userId, q, { limit: 5 }) : Promise.resolve([]),
  ]);
  if (songsRes.status === 'rejected') {
    return res.status(songsRes.reason?.statusCode || 500).json({ error: clientError(songsRes.reason) });
  }
  let songs = songsRes.value;
  const sug = sugRes.status === 'fulfilled' ? sugRes.value : { top: null, artists: [], albums: [], playlists: [] };
  const userPlaylists = plRes.status === 'fulfilled' ? plRes.value : [];

  // Language preference: rank albums; for an album/movie query the hero is the
  // language-preferred album (e.g. Kannada KGF), deduped out of the list, and
  // its songs are ranked too. Intent-gated — ranking songs for a *song* query
  // would promote a same-language near-match over the exact hit.
  // Albums whose NAME matches the query rank FIRST — an exact/substring title
  // like "With Love" must surface (and become the hero) regardless of language —
  // THEN the user's language preference, then catalog order. Previously a
  // non-preferred-language exact match was demoted by language and buried/lost.
  const albumNeedle = q.toLowerCase();
  const nameHit = (a) => (a?.name ?? '').toLowerCase().includes(albumNeedle);
  const langScore = (a) => {
    const i = userLangs.indexOf((a?.language ?? '').toLowerCase());
    return i === -1 ? userLangs.length : i;
  };
  let albums = (sug.albums ?? [])
    .map((a, i) => ({ a, i }))
    .sort((p, n) =>
      ((nameHit(p.a) ? 0 : 1) - (nameHit(n.a) ? 0 : 1))
      || (langScore(p.a) - langScore(n.a))
      || (p.i - n.i))
    .map(o => o.a);
  let top = sug.top;
  if (top?.type === 'album' && albums.length) {
    const a = albums[0];
    top = { type: 'album', id: a.id, name: a.name, image: a.image, isMovie: a.isMovie };
    albums = albums.slice(1);
    songs = rankByLang(songs, userLangs);
  }

  // Artists: only when the best match ISN'T already an artist (the hero covers
  // that case — a separate row would be redundant), and only names that really
  // contain the query (kills the old fuzzy-junk row: "bali" surfaces Yogeeta
  // Bali / Bali Brahmbhatt, not loosely-related names). Cap at 5.
  let artists = [];
  if (top?.type !== 'artist' && (sug.artists?.length ?? 0) > 0) {
    const needle = q.toLowerCase();
    artists = needle.length >= 2
      ? sug.artists.filter(a => (a.name ?? '').toLowerCase().includes(needle)).slice(0, 5)
      : [];
  }

  res.json({ top, songs, artists, albums, playlists: sug.playlists, userPlaylists });
  if (songs.length) cacheTracks(songs);
}));

app.get('/api/catalog/track/:id', async (req, res) => {
  // A cache miss falls through to an upstream lookup — cap the id first so junk
  // can't be relayed to the provider. (security: input caps)
  if (!isId(req.params.id)) return res.status(400).json({ error: 'invalid track id' });
  try {
    const track = await getTrackById(req.params.id);
    res.json(track);
  } catch (err) {
    const status = err.statusCode || 500;
    res.status(status).json({ error: clientError(err) });
  }
});

app.get('/api/tracks/:id/related', optionalAuth, async (req, res) => {
  if (!isId(req.params.id)) return res.status(400).json({ error: 'invalid track id' });
  try {
    const lang = req.query.lang ? String(req.query.lang).slice(0, 40) : undefined;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    let tracks = await getRelatedTracks(req.params.id, { lang, limit });
    // Smart queue for every signed-in listener (was Car-Mode-only): drop hidden/
    // skip-shelved tracks and sink frequent skips. Per-user, post-cache, so the
    // shared similarity cache stays user-agnostic.
    if (req.userId) tracks = await demoteSkipped(req.userId, tracks);
    res.json({ tracks });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: clientError(err) });
  }
});

app.get('/api/artists/lookup', async (req, res) => {
  // name is free text (capped); ids are opaque keys that reach the upstream
  // catalog, so they get the strict shape check. (security: input caps)
  const name    = req.query.name    ? String(req.query.name).slice(0, 200) : undefined;
  const id      = req.query.id      ? String(req.query.id)      : undefined;
  const trackId = req.query.trackId ? String(req.query.trackId) : undefined;
  if ((id && !isId(id)) || (trackId && !isId(trackId))) {
    return res.status(400).json({ error: 'invalid id' });
  }
  try {
    const artist = await getArtistDetails({ name, id, trackId });
    res.json({ artist });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: clientError(err) });
  }
});

app.get('/api/albums/:id', async (req, res) => {
  if (!isId(req.params.id)) return res.status(400).json({ error: 'invalid album id' });
  try {
    const album = await getAlbumDetail(req.params.id);
    res.json({ album });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: clientError(err) });
  }
});

app.get('/api/catalog/featured', optionalAuth, async (req, res) => {
  const lang = req.query.lang ? String(req.query.lang).slice(0, 40) : undefined;
  const limit = clampInt(req.query.limit, 20, 1, 50);
  try {
    // Signed-in: seed the pool from the user's active mode (empty seed for
    // `everyday` → the unchanged global default). Signed-out: global default.
    let seedTracks, seedArtists, modeKey;
    if (req.userId) {
      const u = await query('SELECT active_mode FROM users WHERE id = $1', [req.userId]);
      modeKey = u.rows[0]?.active_mode || 'everyday';
      seedTracks = modeSeedTracks(modeKey);
      seedArtists = modeSeedArtists(modeKey);
    }
    const results = await getFeatured({ lang, limit, seedTracks, seedArtists, modeKey, userId: req.userId });
    res.json({ results });
    cacheTracks(results);
  } catch (err) {
    const status = err.statusCode || 500;
    res.status(status).json({ error: clientError(err) });
  }
});

const LYRICS_TTL_MS = 7 * 24 * 60 * 60 * 1000;  // 7 days

app.get('/api/lyrics/:track_id', optionalAuth, async (req, res) => {
  const { track_id } = req.params;
  // A cache miss reaches the upstream lyrics providers (and getTrackById can
  // reach the catalog) — cap the id before any of that. (security: input caps)
  if (!isId(track_id)) return res.status(400).json({ error: 'invalid track id' });
  const t0 = Date.now();
  // Send the response AND record one timing row. The metric write is
  // fire-and-forget so its DB latency never delays the lyrics response and a
  // failure can never break it — errors are logged, not surfaced or awaited.
  const respond = (body, { cacheHit, source, synced, ok = true, status = 200 }) => {
    recordLyricsMetric({ trackId: track_id, ms: Date.now() - t0, cacheHit, source, synced, ok })
      .catch(e => console.warn('[lyrics] metric write failed:', e.message));
    res.status(status).json(body);
  };
  try {
    const cached = await query(
      `SELECT source, synced, payload, fetched_at FROM lyrics WHERE track_id = $1`,
      [track_id],
    );
    if (cached.rowCount && Date.now() - Number(cached.rows[0].fetched_at) < LYRICS_TTL_MS) {
      const row = cached.rows[0];
      // A 'pending' row means audio generation is in flight — keep polling.
      if (row.source === 'pending') {
        return respond({ available: false, synced: false, pending: true },
          { cacheHit: true, source: 'pending', synced: false });
      }
      return respond(
        { available: row.source !== 'none', synced: row.synced, source: row.source, ...(row.payload ?? {}) },
        { cacheHit: true, source: row.source, synced: row.synced },
      );
    }

    const track = await getTrackById(track_id);
    const result = await getLyricsForTrack({
      trackId: track_id,
      title: track.title,
      artist: track.artist,
      durationSec: track.durationSec,
      language: track.language,
    });

    if (result.synced) {
      await saveLyrics(track_id, {
        source: result.source,
        synced: true,
        payload: { lines: result.lines, has_english: !!result.has_english },
      });
      return respond(result, { cacheHit: false, source: result.source, synced: true });
    }

    // Synced missed, but the catalog had plain (untimed) lyrics. Show them rather
    // than nothing — cached like any terminal result so we replay it next time.
    if (result.available) {
      await saveLyrics(track_id, {
        source: result.source,
        synced: false,
        payload: { lines: result.lines, has_english: !!result.has_english },
      });
      return respond(result, { cacheHit: false, source: result.source, synced: false });
    }

    // No lyrics anywhere — not synced, not even plain. If audio generation is
    // configured AND the caller is authenticated, queue a job and tell the client
    // to poll; otherwise it's simply unavailable. Requiring auth to DISPATCH a
    // paid Replicate job stops an unauthenticated visitor from draining the daily
    // generation budget on arbitrary track ids. (security: M6)
    if (generationEnabled() && req.userId) {
      // Per-user daily ceiling on DISTINCT tracks sent to generation, so one account
      // can't drain the global daily cap. Reserve BEFORE writing the shared 'pending'
      // row — a capped request must not poison the cache (another, under-cap user
      // should still be able to trigger this track). (security: per-account cost)
      if (await reserveUserGenSlot(req.userId, track_id)) {
        await saveLyrics(track_id, { source: 'pending', synced: false, payload: {} });
        const job = await enqueueLyricJob(track_id);
        if (job.status === 'queued') {
          try { await dispatchJob(track_id); }
          catch (err) { console.warn('[lyrics] dispatch failed; reaper will retry:', err.message); }
        }
        return respond({ available: false, synced: false, pending: true },
          { cacheHit: false, source: 'pending', synced: false });
      }
      return respond({ available: false, synced: false, capped: true },
        { cacheHit: false, source: 'capped', synced: false });
    }

    await saveLyrics(track_id, { source: 'none', synced: false, payload: {} });
    return respond({ available: false, synced: false },
      { cacheHit: false, source: 'none', synced: false });
  } catch (err) {
    const status = err.statusCode || 500;
    await respond({ error: clientError(err) },
      { cacheHit: false, source: 'error', synced: false, ok: false, status });
  }
});

// Replicate calls this when a WhisperX prediction completes. Guarded by a shared
// identified by ?track_id. Exempt from the 64kb body cap (see the parser above)
// and from costLimiter (path is not under /api/lyrics). Returns 500 on transient
// failure so Replicate retries the hook. The verify callback captures the raw
// body so HMAC signature verification can run over the exact bytes.
app.post('/api/lyrics-jobs/webhook',
  express.json({ limit: '4mb', verify: (req, _res, buf) => { req.rawBody = buf.toString('utf8'); } }),
  async (req, res) => {
    // Authenticate Replicate's callback. Prefer HMAC signature verification (no
    // secret in the URL, which Replicate logs); else require the shared token.
    // If NEITHER is configured, reject — an open webhook lets anyone forge lyrics
    // into the cache, so it must never run unauthenticated.
    // Prefer HMAC signature verification (no secret in the URL, which Replicate
    // logs). The URL-token fallback is DEV-ONLY — in production HMAC is required,
    // so a leaked/logged token can't authenticate a forged callback. The token
    // compare is constant-time. (security: #11)
    let authed = false;
    if (REPLICATE_WEBHOOK_SIGNING_SECRET) {
      authed = verifyWebhookSignature(req.rawBody, req.headers, REPLICATE_WEBHOOK_SIGNING_SECRET);
    } else if (process.env.NODE_ENV !== 'production' && LYRICS_WEBHOOK_SECRET) {
      authed = safeCompare(req.query.token, LYRICS_WEBHOOK_SECRET);
    }
    if (!authed) return res.status(401).json({ error: 'unauthorized' });
    // Our own dispatcher built this callback URL with a real id — anything
    // oversized is a forgery attempt, not a track.
    const trackId = String(req.query.track_id ?? '');
    if (!isId(trackId)) return res.status(400).json({ error: 'missing track_id' });
    try {
      await completeFromPrediction(req.body, trackId);
      res.json({ ok: true });
    } catch (err) {
      console.warn('[lyrics] webhook handling failed:', err.message);
      res.status(500).json({ error: clientError(err) });
    }
  });

// Cron reaper (Vercel Cron → GET). Recovers stuck jobs and dispatches the queue.
// Authorized ONLY by Vercel's `Authorization: Bearer ${CRON_SECRET}` — never the
// webhook secret (which is logged by Replicate), so a webhook-secret leak can't
// drive the dispatcher. Unreachable until CRON_SECRET is set (i.e. in prod).
app.get('/api/lyrics-jobs/process', async (req, res) => {
  const bearer = (req.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const authed = !!CRON_SECRET && safeCompare(bearer, CRON_SECRET);
  if (!authed) return res.status(401).json({ error: 'unauthorized' });
  try {
    // Daily housekeeping — prune expired/revoked sessions (independent of lyrics
    // generation). Best-effort: never let it fail the reaper.
    await sweepSessions().catch((e) => console.warn('[sessions] sweep failed:', e?.message ?? e));
    // Impression retention (90-day prune) — best-effort, never fails the reaper.
    await pruneOldImpressions().catch((e) => console.warn('[impressions] prune failed:', e?.message ?? e));
    const lyrics = await processQueue();
    // Pre-warm today's made-for-you editions (02:00 UTC ≈ 07:30 IST). Best-effort
    // and time-budgeted so it can never starve the lyrics queue's next run.
    const mixes = await refreshDueMixes({ budgetMs: 30000 })
      .catch((e) => { console.warn('[mixes] refresh failed:', e?.message ?? e); return null; });
    // Announce what the refresh just made — one "your mix is ready" card per
    // user (sendCategory owns the switches/caps/quiet-hours; the 02:00 UTC
    // slot ≈ 07:30 IST lands just past the quiet window by design).
    if (mixes?.fresh?.length) {
      await Promise.allSettled(
        mixes.fresh.map(f => notifyMixesReady(f.userId, f.names, f.coverTrackId)),
      );
    }
    // Re-engagement sweep + cap-log retention — best-effort like the rest.
    const nudges = await sweepNudges()
      .catch((e) => { console.warn('[nudges] sweep failed:', e?.message ?? e); return null; });
    await prunePushLog().catch(() => {});
    // Counts only in the cron log — no user-id lists in Vercel's output.
    res.json({
      ...lyrics,
      mixes: mixes && { users: mixes.users, generated: mixes.generated },
      nudges,
    });
  } catch (err) {
    res.status(500).json({ error: clientError(err) });
  }
});

// Lyrics fetch-time analytics summary (cold p50/p95/avg, cache-hit rate, per
// source). Admin-only: requires the CRON bearer (fail-closed, so unset
// CRON_SECRET ⇒ unreachable, even locally). e.g. GET /api/lyrics-jobs/stats?hours=24
app.get('/api/lyrics-jobs/stats', async (req, res) => {
  // Fail CLOSED: require the CRON bearer (constant-time) even if it means the
  // endpoint is unreachable when CRON_SECRET is unset. (security: #12 / #7)
  const bearer = (req.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const authed = !!CRON_SECRET && safeCompare(bearer, CRON_SECRET);
  if (!authed) return res.status(401).json({ error: 'unauthorized' });
  try {
    const hours = Math.min(Math.max(Number(req.query.hours) || 24, 1), 24 * 30);
    res.json(await getLyricsStats({ hours }));
  } catch (err) {
    res.status(500).json({ error: clientError(err) });
  }
});

const WHY_TTL_MS = 24 * 60 * 60 * 1000;  // 24 hours

app.post('/api/why', async (req, res) => {
  const { track_id, mood, recent_track_ids } = req.body ?? {};
  if (!isId(track_id)) return res.status(400).json({ error: 'missing track_id' });
  // Validate mood against the known vocabulary before it becomes a cache key, so
  // arbitrary strings can't bypass the cache and force a fresh Gemini call. (#14)
  const moodKey = normalizeMood(mood);
  try {
    const cached = await query(
      `SELECT payload, fetched_at FROM why_cache WHERE track_id = $1 AND mood = $2`,
      [track_id, moodKey],
    );
    if (cached.rowCount && Date.now() - Number(cached.rows[0].fetched_at) < WHY_TTL_MS) {
      return res.json(cached.rows[0].payload);
    }

    const track = await getTrackById(track_id);
    let recent = [];
    if (Array.isArray(recent_track_ids) && recent_track_ids.length) {
      // Coerce + shape-check each id so a non-string element can't break the
      // array bind below. (security: input caps)
      const ids = recent_track_ids.slice(0, 5).map(id => String(id)).filter(isId);
      const { rows } = await query(
        `SELECT id, title, artist, language FROM tracks WHERE id = ANY($1::text[])`,
        [ids],
      );
      const byId = new Map(rows.map(r => [r.id, r]));
      recent = ids.map(id => byId.get(id)).filter(Boolean);
    }

    const reason = await generateWhy({ track, mood: moodKey === 'any' ? null : moodKey, recent });
    await pool.query(
      `INSERT INTO why_cache (track_id, mood, payload, fetched_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (track_id, mood) DO UPDATE SET
         payload = EXCLUDED.payload, fetched_at = EXCLUDED.fetched_at`,
      [track_id, moodKey, JSON.stringify(reason), Date.now()],
    );
    res.json(reason);
  } catch (err) {
    const status = err.statusCode || 500;
    res.status(status).json({ error: clientError(err) });
  }
});

app.get('/api/journal', requireAuth, async (req, res) => {
  const days = Math.min(Math.max(Number(req.query.days) || 7, 1), 30);
  try {
    res.json(await getJournalEntries(req.userId, { days }));
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: clientError(err) });
  }
});

app.get('/api/sonic-dna', requireAuth, async (req, res) => {
  try {
    res.json(await getSonicDna(req.userId));
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: clientError(err) });
  }
});

app.post('/api/greeting', async (req, res) => {
  const { mood, track_count, languages, hour } = req.body ?? {};
  try {
    const result = await getGreeting({
      mood,
      // Clamped: it's a sizing hint for the prompt, and an absurd number would
      // otherwise ride into the prompt text verbatim. (security: input caps)
      trackCount: clampInt(track_count, 0, 0, 100000),
      languages: languages ?? {},
      hour: Number.isInteger(hour) ? hour : new Date().getHours(),
    });
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: clientError(err) });
  }
});

app.get('/api/library/summary', requireAuth, async (req, res) => {
  try {
    res.json(await getLibrarySummary(req.userId));
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: clientError(err) });
  }
});

app.get('/api/stats/most-played', requireAuth, async (req, res) => {
  try {
    const days  = clampInt(req.query.days, 30, 1, 365);
    const limit = clampInt(req.query.limit, 10, 1, 50);
    res.json({ tracks: await getMostPlayed(req.userId, { days, limit }) });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: clientError(err) });
  }
});

app.get('/api/stats/top-artists', requireAuth, async (req, res) => {
  try {
    const days  = clampInt(req.query.days, 30, 1, 365);
    const limit = clampInt(req.query.limit, 8, 1, 50);
    res.json({ artists: await getTopArtists(req.userId, { days, limit }) });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: clientError(err) });
  }
});

app.get('/api/stats/recently-played', requireAuth, async (req, res) => {
  try {
    const limit = clampInt(req.query.limit, 10, 1, 50);
    res.json({ tracks: await getRecentlyPlayed(req.userId, { limit }) });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: clientError(err) });
  }
});

// Quick picks — anchored + daily-rotating home ring (quickPicks.js). `salt` is
// the user's "shuffle all" reroll; capped so it can't bloat the rotation seed.
app.get('/api/home/quick-picks', requireAuth, async (req, res) => {
  try {
    const salt = String(req.query.salt ?? '').slice(0, 32);
    res.json(await getQuickPicks(req.userId, { tzOffset: req.query.tzOffset, salt }));
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: clientError(err) });
  }
});

// Personalized home surfaces (server/homeReco.js). Each returns null below its
// history floor — the client then keeps its honest featured fallback, so a new
// account degrades gracefully instead of seeing fabricated personalization.
app.get('/api/home/hero', requireAuth, async (req, res) => {
  try {
    res.json(await getPersonalHero(req.userId, { tzOffset: req.query.tzOffset }));
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: clientError(err) });
  }
});
app.get('/api/home/new-for-you', requireAuth, async (req, res) => {
  try {
    res.json(await getNewForYou(req.userId, {}));
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: clientError(err) });
  }
});
app.get('/api/home/stations', requireAuth, async (req, res) => {
  try {
    res.json(await getStations(req.userId));
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: clientError(err) });
  }
});

// Impression log — what a home surface SHOWED (quickPicks demotion signal).
// Fire-and-forget from the client, mirrors /api/events' input caps.
app.post('/api/impressions', requireAuth, async (req, res) => {
  const { surface, tzOffset, track_ids } = req.body ?? {};
  if (!surface || !Array.isArray(track_ids) || !track_ids.length) {
    return res.status(400).json({ error: 'invalid surface or track_ids' });
  }
  try {
    await recordImpressions(req.userId, {
      surface: String(surface).slice(0, 40),
      tzOffset,
      trackIds: track_ids.slice(0, 40).map(id => String(id)).filter(isId),
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: clientError(err) });
  }
});

// ── Multi-device playback awareness (near-real-time via heartbeat + poll) ──
// Cheap DB-only routes (generalLimiter, not the LLM cost limiter). The playing
// device heartbeats its current track into its own session row; other devices
// poll /now to show a passive "playing on <device>" note; /resume powers
// cross-device "continue where you left off". (parallel-usage awareness)
app.post('/api/playback/heartbeat', requireAuth, async (req, res) => {
  try {
    const { track, isPlaying, progress } = req.body ?? {};
    await recordHeartbeat(req.sessionId, req.userId, { track, isPlaying, progress });
    res.json({ ok: true });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: clientError(err) });
  }
});

app.get('/api/playback/now', requireAuth, async (req, res) => {
  try {
    res.json({ playing: await getNowPlaying(req.userId, req.sessionId) });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: clientError(err) });
  }
});

app.get('/api/playback/resume', requireAuth, async (req, res) => {
  try {
    res.json({ resume: await getResume(req.userId, req.sessionId) });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: clientError(err) });
  }
});

// Volume-leveling data: measured-once integrated loudness per track (see
// server/loudness.js). Absent ids just haven't been measured yet — clients
// play those unleveled and POST a measure so the next listener has them.
app.get('/api/loudness', requireAuth, async (req, res) => {
  try {
    // Shape-check + cap the id list — it binds into ANY($1) and an unbounded
    // list is free DB load. Real clients ask for two. (security: input caps)
    const ids = String(req.query.ids ?? '').split(',').filter(isId).slice(0, 100);
    res.json({ tracks: await getLoudness(ids) });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: clientError(err) });
  }
});

// LOCAL DEV ONLY in effect: in production vercel.json rewrites this exact path
// to its own serverless function (api/loudness-measure.js) before it can reach
// this app, so the ~80MB ffmpeg binary never bloats the main bundle. The
// module name lives in a variable so the dependency tracer can't see it and
// pull ffmpeg-static in here.
const FFMPEG_MODULE = 'ffmpeg-static';
app.post('/api/loudness/measure', requireAuth, loudnessMeasureHandler(async () => {
  try {
    return (await import(FFMPEG_MODULE)).default;
  } catch {
    return null;
  }
}));

// Karaoke "music only": one idempotent endpoint claims/advances the per-track
// stems state machine (server/stems.js). Clients poll it while showing
// "preparing…"; the heavy separation runs on MVSEP, never in a function.
app.post('/api/stems/request', requireAuth, stemsRequestHandler());

// ── Composed notification card art ───────────────────────────────────
// PUBLIC by necessity: FCM fetches card images with no credentials. Composes
// the branded 1000×500 card (server/cardArt.js) — art full-bleed under the
// scrim, the seeded ribbon wave, ring mark + wordmark. `art` must be
// aura-hosted (catalog CDN / Blob store — the endpoint would otherwise be an
// open image proxy); absent art = the brand-only card. Immutable-cached so
// each distinct card renders once at the edge.
const cardArtLimiter = buildLimiter(5 * 60 * 1000, 120, 'too many requests — slow down a moment.', 'cardart');
app.get('/api/push/card-art', cardArtLimiter, async (req, res) => {
  try {
    const artUrl = typeof req.query.art === 'string' && req.query.art ? req.query.art : null;
    if (artUrl && !allowedArtUrl(artUrl)) {
      return res.status(400).json({ error: 'art must be an aura-hosted image url' });
    }
    const seed = typeof req.query.seed === 'string' && req.query.seed
      ? req.query.seed.slice(0, 120)
      : (artUrl ?? 'aura');
    const art = artUrl ? await fetchArt(artUrl) : null;
    const png = renderCardPng({ art, seed });
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'public, max-age=86400, s-maxage=31536000, immutable');
    res.send(png);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: clientError(err) });
  }
});

// ── FCM device registration (native app) ─────────────────────────────
// Upsert keyed on the token: a device switching accounts re-homes its token
// to the new user (last sign-in wins — matching what the device itself just
// did). Sign-out DELETEs its own row (owner-scoped) so a logged-out phone is
// never pushed to. Dead tokens are also pruned by the sender (server/push.js).
app.post('/api/push/register', requireAuth, async (req, res) => {
  const token = typeof req.body?.token === 'string' ? req.body.token : '';
  if (token.length < 20 || token.length > 4096) {
    return res.status(400).json({ error: 'invalid token' });
  }
  try {
    const now = Date.now();
    await query(
      `INSERT INTO push_tokens (token, user_id, platform, created_at, last_seen_at)
       VALUES ($1, $2, 'android', $3, $3)
       ON CONFLICT (token) DO UPDATE SET
         user_id = EXCLUDED.user_id, last_seen_at = EXCLUDED.last_seen_at`,
      [token, req.userId, now],
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: clientError(err) });
  }
});

app.delete('/api/push/register', requireAuth, async (req, res) => {
  const token = typeof req.body?.token === 'string' ? req.body.token : '';
  if (!token || token.length > 4096) {
    return res.status(400).json({ error: 'invalid token' });
  }
  try {
    await query(
      'DELETE FROM push_tokens WHERE token = $1 AND user_id = $2',
      [token, req.userId],
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: clientError(err) });
  }
});

// ── Notification preferences (the settings switches, both clients) ────
// Absent row = all on; the PUT upserts only the fields it's sent, so each
// switch can flip independently.
app.get('/api/push/prefs', requireAuth, async (req, res) => {
  try {
    res.json(await getPrefs(req.userId));
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: clientError(err) });
  }
});

app.put('/api/push/prefs', requireAuth, async (req, res) => {
  const body = req.body ?? {};
  for (const k of ['mixes', 'social', 'nudges']) {
    if (body[k] !== undefined && typeof body[k] !== 'boolean') {
      return res.status(400).json({ error: 'invalid prefs' });
    }
  }
  try {
    await query(
      `INSERT INTO notification_prefs (user_id, mixes, social, nudges, updated_at)
       VALUES ($1, COALESCE($2, TRUE), COALESCE($3, TRUE), COALESCE($4, TRUE), $5)
       ON CONFLICT (user_id) DO UPDATE SET
         mixes      = COALESCE($2, notification_prefs.mixes),
         social     = COALESCE($3, notification_prefs.social),
         nudges     = COALESCE($4, notification_prefs.nudges),
         updated_at = $5`,
      [req.userId, body.mixes ?? null, body.social ?? null, body.nudges ?? null, Date.now()],
    );
    res.json(await getPrefs(req.userId));
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: clientError(err) });
  }
});

// ── In-app notification feed (the bell/panel) ────────────────────────
// A durable log of the same cards the triggers push (server/notify.js) —
// always written regardless of push prefs/quiet hours, so nothing is lost
// to a muted category or a phone with no token. See server/notifications.js.
app.get('/api/notifications', requireAuth, async (req, res) => {
  try {
    res.json({ notifications: await listNotifications(req.userId) });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: clientError(err) });
  }
});

app.post('/api/notifications/seen', requireAuth, async (req, res) => {
  try {
    await markNotificationsSeen(req.userId);
    res.json({ ok: true });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: clientError(err) });
  }
});

// ── Admin push console ───────────────────────────────────────────────
// Authorization = the signed-in user's email is on the ADMIN_EMAILS
// allowlist (server env). Independent of ADMIN_ONLY (the dev sign-in gate):
// this is the prod check, and an empty allowlist means nobody — fail closed.
async function requireAdmin(req, res, next) {
  try {
    const { rows } = await query('SELECT email FROM users WHERE id = $1', [req.userId]);
    if (!rows.length || !isAdminEmail(rows[0].email)) {
      return res.status(403).json({ error: 'admin only' });
    }
    next();
  } catch (err) {
    res.status(500).json({ error: clientError(err) });
  }
}

// What a send would reach, and whether the sender is configured at all —
// the console shows both before the button.
app.get('/api/admin/push/reach', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { rows } = await query(
      'SELECT COUNT(*) AS devices, COUNT(DISTINCT user_id) AS users FROM push_tokens',
    );
    res.json({
      devices: Number(rows[0].devices),
      users: Number(rows[0].users),
      configured: !!process.env.FIREBASE_ADMIN_JSON,
    });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: clientError(err) });
  }
});

// Compose + send. audience: 'all' (every enrolled user) | 'me' (the admin's
// own devices — the safe dry-run) | an email (one user). Deliberately rides
// sendToUser, NOT sendCategory: a human pressing the button IS the cap, and
// admin cards must not be silenced by category switches or quiet hours.
const httpsUrl = (v) => typeof v === 'string' && /^https:\/\//.test(v) && v.length <= 1000;
app.post('/api/admin/push/send', requireAuth, requireAdmin, async (req, res) => {
  const { title, body, image, link, audience } = req.body ?? {};
  if (typeof title !== 'string' || !title.trim() || title.length > 120) {
    return res.status(400).json({ error: 'title required (max 120 chars)' });
  }
  if (typeof body !== 'string' || !body.trim() || body.length > 300) {
    return res.status(400).json({ error: 'body required (max 300 chars)' });
  }
  if (image !== undefined && image !== '' && !httpsUrl(image)) {
    return res.status(400).json({ error: 'image must be an https url' });
  }
  if (link !== undefined && link !== '' && !httpsUrl(link)) {
    return res.status(400).json({ error: 'link must be an https url' });
  }
  try {
    let userIds = [];
    if (audience === 'me' || audience === undefined || audience === '') {
      userIds = [req.userId];
    } else if (audience === 'all') {
      const { rows } = await query('SELECT DISTINCT user_id FROM push_tokens');
      userIds = rows.map(r => r.user_id);
    } else if (typeof audience === 'string' && audience.includes('@') && audience.length <= 254) {
      const { rows } = await query(
        'SELECT id FROM users WHERE email = $1',
        [audience.toLowerCase().trim()],
      );
      if (!rows.length) return res.status(404).json({ error: 'no user with that email' });
      userIds = [rows[0].id];
    } else {
      return res.status(400).json({ error: 'audience must be "me", "all", or an email' });
    }
    const payload = {
      title: title.trim(),
      body: body.trim(),
      ...(httpsUrl(image) ? { image } : {}),
      link: httpsUrl(link) ? link : 'https://www.aurafm.live/',
      collapseKey: 'admin',
    };
    let sent = 0;
    for (const uid of userIds) {
      const out = await sendToUser(uid, payload);
      sent += out.sent;
      await recordNotification(uid, 'note', payload);
    }
    res.json({ users: userIds.length, sent });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: clientError(err) });
  }
});

// Full listening history (paginated, newest first) for the song-history screen.
app.get('/api/history', requireAuth, async (req, res) => {
  try {
    const limit  = Math.min(Math.max(Number(req.query.limit) || 80, 1), 200);
    // Cursor must be a real ms timestamp — a garbled value would otherwise ride
    // into the bigint comparison as NaN/overflow. (security: input caps)
    const before = clampInt(req.query.before, undefined, 1, Number.MAX_SAFE_INTEGER);
    res.json(await getHistory(req.userId, { limit, before }));
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: clientError(err) });
  }
});

// Windowed plays for the "music clock" — bucketed into parts of day on the client.
app.get('/api/history/clock', requireAuth, async (req, res) => {
  try {
    const days = Math.min(Math.max(Number(req.query.days) || 60, 1), 365);
    res.json({ plays: await getMusicClockPlays(req.userId, { days }) });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: clientError(err) });
  }
});

app.get('/api/discover/home', async (req, res) => {
  try {
    const lang = req.query.lang ? String(req.query.lang).slice(0, 40) : undefined;
    res.json(await getDiscoverHome({ lang }));
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: clientError(err) });
  }
});

app.get('/api/discover/playlist/:id', async (req, res) => {
  // The id goes straight to the upstream catalog — shape-check it first.
  if (!isId(req.params.id)) return res.status(400).json({ error: 'invalid playlist id' });
  try {
    res.json(await getCatalogPlaylistDetail(req.params.id));
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: clientError(err) });
  }
});

app.get('/api/mood/current', requireAuth, async (req, res) => {
  try {
    const snapshot = req.query.refresh === '1'
      ? await refreshMood(req.userId)   // throttled re-infer — bounds forced Gemini spend (M4)
      : await inferIfStale(req.userId);
    res.json(snapshot ?? { mood: null, confidence: 0, drift: 'steady', events_seen: 0 });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: clientError(err) });
  }
});

app.post('/api/llm/talk', requireAuth, async (req, res) => {
  const { message, history, context } = req.body ?? {};
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'missing message' });
  }
  // Bound the client-supplied prompt inputs before they reach the LLM — caps
  // token cost and request size regardless of the body-parser. (security: #18/M5)
  if (message.length > 2000) return res.status(400).json({ error: 'message too long' });
  const safeHistory = Array.isArray(history) ? history.slice(-20) : undefined;
  try {
    const enriched = await buildTalkContext(req.userId, context).catch(() => context ?? {});
    const snapshot = await inferIfStale(req.userId).catch(() => null);
    if (snapshot?.mood && snapshot.confidence >= 0.5) enriched.mood = snapshot.mood;

    const result = await generateTalk({ message, history: safeHistory, context: enriched });
    let tracks = [];
    if (result?.action?.kind === 'queue' && result.action.query) {
      // count=1 is allowed (specific-song request); cap at 10.
      const limit = Math.min(Math.max(result.action.count || 5, 1), 10);
      try {
        tracks = await searchSongs(result.action.query, {
          lang:  result.action.language || undefined,
          limit,
        });
        // Auto-extend: a single-song pick stops cold when it ends. Pull 3 more
        // song-similar (reco) tracks so playback flows naturally — not the artist's hits.
        if (tracks.length === 1 && tracks[0].artist) {
          try {
            const radio = await getRelatedTracks(tracks[0].id, {
              lang:  result.action.language || tracks[0].language || undefined,
              limit: 4,
            });
            // Filter out the seed track; keep up to 3 extras.
            const extras = radio
              .filter(t => t.id !== tracks[0].id)
              .slice(0, 3);
            tracks = [...tracks, ...extras];
          } catch (radioErr) {
            console.warn('[talk] song radio failed:', radioErr.message);
          }
        }
        cacheTracks(tracks);
      } catch (searchErr) {
        console.warn('[talk] catalog search failed:', searchErr.message);
      }
    }
    res.json({ reply: result.reply, action: result.action, tracks, suggestions: sanitizeSuggestions(result.suggestions) });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: clientError(err) });
  }
});

app.get('/api/bridges/suggest', requireAuth, async (req, res) => {
  try {
    const hour = clampInt(req.query.hour, new Date().getHours(), 0, 23);
    res.json(await getBridgeSuggestion(req.userId, { hour }));
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: clientError(err) });
  }
});

app.get('/api/bridges/:from/:to', requireAuth, async (req, res) => {
  try {
    const steps = Number(req.query.steps) || 5;
    const langs = String(req.query.langs ?? '')
      .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    const bridge = await getBridgeTracks({
      userId: req.userId, from: req.params.from, to: req.params.to, steps, langs,
    });
    res.json({ from: req.params.from, to: req.params.to, ...bridge });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: clientError(err) });
  }
});

app.get('/api/likes', requireAuth, async (req, res) => {
  try {
    if (req.query.ids === '1') {
      res.json({ ids: await listLikedIds(req.userId) });
    } else {
      res.json({ liked: await listLiked(req.userId) });
    }
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: clientError(err) });
  }
});

app.post('/api/likes', requireAuth, async (req, res) => {
  const { track_id } = req.body ?? {};
  // likeTrack falls through to an upstream lookup on a cache miss — shape-check
  // the id here so junk never gets relayed. (security: input caps)
  if (!isId(track_id)) return res.status(400).json({ error: 'missing track_id' });
  try {
    await likeTrack(req.userId, track_id);
    res.json({ ok: true });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: clientError(err) });
  }
});

app.delete('/api/likes/:track_id', requireAuth, async (req, res) => {
  try {
    await unlikeTrack(req.userId, req.params.track_id);
    res.json({ ok: true });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: clientError(err) });
  }
});

// Hidden tracks — "don't show this again." A hard exclusion from every
// made-for-you pick (mixes + auto-radio); visible and undoable in Settings.
app.get('/api/hidden', requireAuth, async (req, res) => {
  try {
    res.json({ hidden: await listHidden(req.userId) });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: clientError(err) });
  }
});

app.post('/api/hidden', requireAuth, async (req, res) => {
  const { track_id } = req.body ?? {};
  if (!track_id) return res.status(400).json({ error: 'missing track_id' });
  try {
    await hideTrack(req.userId, track_id);
    res.json({ ok: true });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: clientError(err) });
  }
});

app.delete('/api/hidden/:track_id', requireAuth, async (req, res) => {
  try {
    await unhideTrack(req.userId, req.params.track_id);
    res.json({ ok: true });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: clientError(err) });
  }
});

app.get('/api/playlists', requireAuth, async (req, res) => {
  try {
    res.json({ playlists: await listPlaylists(req.userId) });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: clientError(err) });
  }
});

// MUST be declared before `/:id` — Express matches in order, so otherwise
// `getPlaylist(userId, 'auto')` would 404 instead of returning the smart sets.
app.get('/api/playlists/auto', requireAuth, async (req, res) => {
  try {
    // tzOffset (JS getTimezoneOffset convention) keys editions to the USER'S
    // calendar day — the music-clock endpoint set this precedent.
    res.json({ playlists: await getAutoPlaylists(req.userId, { tzOffset: req.query.tzOffset }) });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: clientError(err) });
  }
});

// Saved (not owned) playlists — MUST precede /:id so 'saved' isn't read as an id.
app.get('/api/playlists/saved', requireAuth, async (req, res) => {
  try {
    res.json({ playlists: await listSavedPlaylists(req.userId) });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: clientError(err) });
  }
});

app.get('/api/playlists/:id', requireAuth, async (req, res) => {
  try {
    res.json(await getPlaylist(req.userId, req.params.id));
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: clientError(err) });
  }
});

app.post('/api/playlists', requireAuth, async (req, res) => {
  const { name, description } = req.body ?? {};
  try {
    const playlist = await createPlaylist(req.userId, { name, description });
    res.json(playlist);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: clientError(err) });
  }
});

app.delete('/api/playlists/:id', requireAuth, async (req, res) => {
  try {
    await deletePlaylist(req.userId, req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: clientError(err) });
  }
});

app.post('/api/playlists/:id/tracks', requireAuth, async (req, res) => {
  const { track_id } = req.body ?? {};
  if (!isId(track_id)) return res.status(400).json({ error: 'missing track_id' });
  try {
    // The track must already be in our catalog cache (search/featured/play all
    // upsert it locally). Check LOCALLY only — never getTrackById here: a miss
    // there falls through to an upstream provider call, an amplification vector.
    // Mirrors the /api/events guard. (security: #30)
    const known = await query('SELECT 1 FROM tracks WHERE id = $1', [track_id]);
    if (!known.rowCount) return res.status(404).json({ error: 'unknown track' });
    await addTrackToPlaylist(req.userId, req.params.id, track_id);
    // Tell the OTHER members (never the actor); notify.js swallows its own
    // errors and sendCategory caps the frequency, so this can't fail or spam
    // the request that triggered it.
    notifyTrackAdded(req.userId, req.params.id, track_id).catch(() => {});
    res.json({ ok: true });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: clientError(err) });
  }
});

app.delete('/api/playlists/:id/tracks/:track_id', requireAuth, async (req, res) => {
  try {
    await removeTrackFromPlaylist(req.userId, req.params.id, req.params.track_id);
    res.json({ ok: true });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: clientError(err) });
  }
});

// Cheap change cursor for collaboration polling.
app.get('/api/playlists/:id/rev', requireAuth, async (req, res) => {
  try {
    res.json(await getPlaylistRev(req.userId, req.params.id));
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: clientError(err) });
  }
});

// Owner mints a share invite. body: { role?: 'editor' | 'viewer' }
app.post('/api/playlists/:id/invite', requireAuth, async (req, res) => {
  try {
    res.json(await createInvite(req.userId, req.params.id, { role: req.body?.role }));
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: clientError(err) });
  }
});

// Accept a share invite → become a collaborator. (No :id — distinct path.)
app.post('/api/playlists/invite/:token/accept', requireAuth, async (req, res) => {
  try {
    const out = await acceptInvite(req.userId, req.params.token);
    // The owner learns they have company (skipped when the owner accepted
    // their own link — notify.js checks actor vs owner).
    notifyInviteAccepted(req.userId, out.playlistId).catch(() => {});
    res.json(out);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: clientError(err) });
  }
});

// Remove a collaborator (owner removes anyone; a collaborator removes themselves).
app.delete('/api/playlists/:id/collaborators/:user_id', requireAuth, async (req, res) => {
  try {
    await removeCollaborator(req.userId, req.params.id, req.params.user_id);
    res.json({ ok: true });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: clientError(err) });
  }
});

// Owner toggles public view-only sharing. body: { public: boolean }. Returns
// { isPublic, publicId } — publicId feeds the /p/:publicId share link.
app.post('/api/playlists/:id/visibility', requireAuth, async (req, res) => {
  try {
    res.json(await setPlaylistVisibility(req.userId, req.params.id, !!req.body?.public));
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: clientError(err) });
  }
});

// Owner makes a playlist private ("only you") — revokes collaborators + invites
// + the public link in one call. Returns { isPublic:false, onlyMe:true }.
app.post('/api/playlists/:id/only-me', requireAuth, async (req, res) => {
  try {
    res.json(await setPlaylistOnlyMe(req.userId, req.params.id));
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: clientError(err) });
  }
});

// Image upload → Vercel Blob. Raw image body (client resizes first); ?kind=cover|avatar.
app.post('/api/uploads/image', requireAuth, express.raw({ type: () => true, limit: '2560kb' }), async (req, res) => {
  try {
    res.json(await uploadImage(req.userId, {
      kind: String(req.query.kind ?? ''),
      contentType: req.headers['content-type'],
      body: req.body,
    }));
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: clientError(err) });
  }
});

// Set the playlist cover (owner/editor). body: { trackId } OR { imageUrl } (a
// Blob URL from /api/uploads/image; it takes precedence).
app.post('/api/playlists/:id/cover', requireAuth, async (req, res) => {
  try {
    // trackId gets the id shape check; imageUrl is length-capped + host-pinned
    // inside isBlobUrl (setPlaylistCover rejects everything else).
    const trackId = req.body?.trackId ? String(req.body.trackId) : undefined;
    if (trackId && !isId(trackId)) {
      return res.status(400).json({ error: 'invalid track id' });
    }
    res.json(await setPlaylistCover(req.userId, req.params.id, {
      trackId,
      imageUrl: req.body?.imageUrl ? String(req.body.imageUrl) : undefined,
    }));
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: clientError(err) });
  }
});

// Save / unsave someone else's playlist to your library.
app.post('/api/playlists/:id/save', requireAuth, async (req, res) => {
  try {
    res.json(await savePlaylist(req.userId, req.params.id));
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: clientError(err) });
  }
});
app.delete('/api/playlists/:id/save', requireAuth, async (req, res) => {
  try {
    res.json(await unsavePlaylist(req.userId, req.params.id));
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: clientError(err) });
  }
});

// PUBLIC, view-only read by share id — intentionally NO requireAuth so a shared
// link opens for anyone in any browser. Reads only local rows (no upstream
// catalog calls → no amplification). 404s when the id is unknown or not public.
app.get('/api/public/playlists/:publicId', async (req, res) => {
  try {
    res.set('Cache-Control', 'public, max-age=60');
    res.json(await getPublicPlaylist(req.params.publicId));
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: clientError(err) });
  }
});

const EVENT_KINDS = new Set(['play', 'pause', 'skip', 'seek', 'end']);

app.post('/api/events', requireAuth, async (req, res) => {
  const { track_id, kind, position_sec, mood, language, mode, source } = req.body ?? {};
  if (!isId(track_id) || !EVENT_KINDS.has(kind)) {
    return res.status(400).json({ error: 'invalid track_id or kind' });
  }
  // Bound the free-text signal columns (mirrors `source`) so a client can't grow
  // listening_events rows unbounded. (security: input caps)
  const src  = source   != null ? String(source).slice(0, 80)   : null;
  const mood_ = mood     != null ? String(mood).slice(0, 50)     : null;
  const lang_ = language != null ? String(language).slice(0, 40) : null;
  const mode_ = mode     != null ? String(mode).slice(0, 40)     : null;
  // position_sec is a number from real clients — coerce + bound it so a junk
  // value can't fail the insert or store a nonsense position.
  const pos = position_sec != null && Number.isFinite(Number(position_sec))
    ? Math.min(Math.max(Number(position_sec), 0), 86400)
    : null;
  try {
    // The track must already be in our catalog cache (it's upserted whenever a
    // track is loaded/played). Check LOCALLY only — never getTrackById here: a
    // DB miss there falls through to an upstream provider call, so phantom ids
    // would become an amplification vector. Unknown id → reject, don't pollute
    // listening_events (it feeds mood/language affinity).
    const known = await query('SELECT 1 FROM tracks WHERE id = $1', [track_id]);
    if (!known.rowCount) return res.status(404).json({ error: 'unknown track' });
    // Non-idempotent INSERT (no unique key) → retries:0 so a transient-socket replay
    // can't double-count an event and skew mood/language affinity.
    await query(
      `INSERT INTO listening_events (user_id, track_id, ts, kind, position_sec, mood, language, mode, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [req.userId, track_id, Date.now(), kind, pos, mood_, lang_, mode_, src],
      { retries: 0 },
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: clientError(err) });
  }
});

app.get('/api/events/recent', requireAuth, async (req, res) => {
  const limit = clampInt(req.query.limit, 50, 1, 500);
  try {
    const { rows } = await query(
      `SELECT id, track_id, ts, kind, position_sec, mood, language
       FROM listening_events WHERE user_id = $1 ORDER BY ts DESC LIMIT $2`,
      [req.userId, limit],
    );
    res.json({ events: rows });
  } catch (err) {
    res.status(500).json({ error: clientError(err) });
  }
});

// ── Open Graph for public playlist links (/p/:publicId) ──────────────────
// vercel.json rewrites /p/* to this function (NOT to the static index.html), so
// link-preview crawlers (WhatsApp/Discord/Slack/iMessage/Twitter) get
// per-playlist OG tags instead of the generic landing card. Real browsers get
// the SAME built SPA shell (with its hashed bootstrap) and hydrate into
// PublicPlaylistScreen — only the <title>/og:*/twitter:* meta differ. Dev is
// unaffected: Vite serves /p/* as the SPA, so this route is reached only in prod.
const escAttr = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function injectPlaylistOg(html, { title, description, image, url }) {
  const t = escAttr(title), d = escAttr(description), img = escAttr(image), u = escAttr(url);
  return html
    .replace(/<title>[^<]*<\/title>/, `<title>${t}</title>`)
    .replace(/(<meta name="description" content=")[^"]*(")/, `$1${d}$2`)
    .replace(/(<link rel="canonical" href=")[^"]*(")/, `$1${u}$2`)
    .replace(/(<meta property="og:title" content=")[^"]*(")/, `$1${t}$2`)
    .replace(/(<meta property="og:description" content=")[^"]*(")/, `$1${d}$2`)
    .replace(/(<meta property="og:url" content=")[^"]*(")/, `$1${u}$2`)
    .replace(/(<meta property="og:image" content=")[^"]*(")/, `$1${img}$2`)
    .replace(/(<meta name="twitter:title" content=")[^"]*(")/, `$1${t}$2`)
    .replace(/(<meta name="twitter:description" content=")[^"]*(")/, `$1${d}$2`)
    .replace(/(<meta name="twitter:image" content=")[^"]*(")/, `$1${img}$2`);
}

app.get('/p/:publicId', async (req, res) => {
  // Fixed origin (PUBLIC_BASE_URL) to fetch the built shell — avoids trusting a
  // spoofable Host header; falls back to the request host if unset (local/preview).
  const base = process.env.PUBLIC_BASE_URL || `https://${req.headers.host}`;
  try {
    // The built SPA shell uses absolute /assets/ paths, so it boots fine at /p/:id.
    // Own origin, but still an unbounded network call inside a serverless
    // invocation — a stalled edge would hold the slot to maxDuration and the
    // crawler would get nothing. The shell is a static file; 5s is generous.
    const html = await fetch(`${base}/index.html`, {
      signal: AbortSignal.timeout(SHELL_FETCH_TIMEOUT_MS),
    }).then(r => r.text());
    let pl = null;
    try { pl = await getPublicPlaylist(req.params.publicId); }
    catch { /* unknown / private → serve the generic card, not a 404 page */ }
    const out = pl
      ? injectPlaylistOg(html, {
          title:       `${pl.name} · AURA`,
          description: `${pl.name}${pl.ownerName ? ` · a playlist by ${pl.ownerName}` : ''} on AURA${pl.trackCount ? ` · ${pl.trackCount} tracks` : ''}.`,
          image:       pl.coverImageUrl || `${base}/og.png`,
          url:         `${base}/p/${req.params.publicId}`,
        })
      : html;
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.set('Cache-Control', 'public, max-age=300');
    res.send(out);
  } catch (err) {
    // Shell fetch failed (rare) — bounce to the SPA root (NOT back to /p/:id,
    // which would re-enter this handler and loop) so the app still loads.
    console.error('[og] shell fetch failed:', err?.message ?? err);
    res.redirect(302, '/');
  }
});

// ── Open Graph for shared song links (/t/:trackId[?at=sec]) ──────────────
// Same shape as /p/ above: vercel.json rewrites /t/* here, crawlers get
// per-song meta (title · artist, the cover as the card), browsers get the SPA
// shell and hydrate — App.jsx spots the /t/ path, loads the song, and seeks
// to ?at= if the link names a moment.
app.get('/t/:trackId', async (req, res) => {
  const base = process.env.PUBLIC_BASE_URL || `https://${req.headers.host}`;
  try {
    // Own origin, but still an unbounded network call inside a serverless
    // invocation — a stalled edge would hold the slot to maxDuration and the
    // crawler would get nothing. The shell is a static file; 5s is generous.
    const html = await fetch(`${base}/index.html`, {
      signal: AbortSignal.timeout(SHELL_FETCH_TIMEOUT_MS),
    }).then(r => r.text());
    let track = null;
    if (isId(req.params.trackId)) {
      try { track = await getTrackById(req.params.trackId); }
      catch { /* unknown id → serve the generic card, not a 404 page */ }
    }
    const at = Number(req.query.at);
    const stamp = Number.isFinite(at) && at > 0
      ? ` · from ${Math.floor(at / 60)}:${String(Math.floor(at % 60)).padStart(2, '0')}`
      : '';
    const out = track
      ? injectPlaylistOg(html, {
          title:       `${track.title} · ${track.artist || 'AURA'}`,
          description: `${track.title}${track.artist ? ` by ${track.artist}` : ''} on AURA${stamp}.`,
          // The catalog serves art at whatever size it was cached at (often
          // 150x150) — upscale so the preview card is sharp, not fuzzy.
          image:       track.imageUrl
            ? track.imageUrl.replace(/\d+x\d+/, '500x500')
            : `${base}/og.png`,
          url:         `${base}/t/${req.params.trackId}`,
        })
      : html;
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.set('Cache-Control', 'public, max-age=300');
    res.send(out);
  } catch (err) {
    // Shell fetch failed (rare) — bounce to the SPA root (NOT back to /t/:id,
    // which would re-enter this handler and loop) so the app still loads.
    console.error('[og] shell fetch failed:', err?.message ?? err);
    res.redirect(302, '/');
  }
});

// Terminal handlers, mounted LAST. notFound answers any unmatched /api path with
// JSON 404; errorMiddleware is the single place that turns a thrown/forwarded
// error into a scrubbed client response (and logs the full detail server-side).
// Express 4 routes a rejected async handler here only when it's wrapped with
// asyncHandler (see ./middleware/errors.js) or calls next(err). (#26/#27)
app.use(notFound);
app.use(errorMiddleware);

export default app;
