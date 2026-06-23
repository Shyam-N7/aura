import express from 'express';
import { rateLimit } from 'express-rate-limit';
import { pool } from './db.js';
import { searchSongs, searchSuggest, rankByLang } from './catalog.js';
import { getTrackById, cacheTracks } from './tracks.js';
import { getFeatured } from './featured.js';
import { getLyricsForTrack } from './lyrics.js';
import {
  generationEnabled, saveLyrics, enqueueLyricJob, dispatchJob,
  completeFromPrediction, processQueue,
} from './lyricsJobs.js';
import { recordLyricsMetric, getLyricsStats } from './lyricsMetrics.js';
import { LYRICS_WEBHOOK_SECRET, REPLICATE_WEBHOOK_SIGNING_SECRET, CRON_SECRET } from './config.js';
import { verifyWebhookSignature } from './replicateWebhook.js';
import { generateWhy } from './prompts/why.js';
import { getJournalEntries } from './journal.js';
import { getSonicDna } from './sonicDna.js';
import { listLiked, listLikedIds, likeTrack, unlikeTrack } from './likes.js';
import { listPlaylists, getPlaylist, getPlaylistRev, createPlaylist, deletePlaylist, addTrackToPlaylist, removeTrackFromPlaylist, searchPlaylists, createInvite, acceptInvite, removeCollaborator } from './playlists.js';
import { getLibrarySummary } from './library.js';
import { getGreeting } from './greeting.js';
import { getMostPlayed, getTopArtists, getRecentlyPlayed, getHistory, getMusicClockPlays } from './stats.js';
import { getAutoPlaylists } from './autoPlaylists.js';
import { getDiscoverHome } from './discover.js';
import { getCatalogPlaylistDetail } from './catalog.js';
import { getBridgeTracks, getBridgeSuggestion } from './bridges.js';
import { getRelatedTracks } from './related.js';
import { getArtistDetails, getAlbumDetail } from './artists.js';
import { generateTalk, sanitizeSuggestions } from './prompts/talk.js';
import { getCurrentMood, inferMood, inferIfStale } from './mood.js';
import { buildTalkContext } from './context.js';
import authRouter from './auth.js';
import familyRouter from './family.js';
import modesRouter from './modesRoutes.js';
import { modeSeedArtists } from './modes.js';
import { requireAuth, optionalAuth } from './middleware/auth.js';

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
  if (req.body && typeof req.body === 'object') return next();
  express.json({ limit: '64kb' })(req, res, next);
});

// ── Rate limiting ───────────────────────────────────────────────────
// Behind Vercel's edge (a single proxy) — trust ONE hop so req.ip is the real
// client for per-IP limiting. NOT `true`, which would let clients spoof
// X-Forwarded-For. Locally there's no proxy header so req.ip is the socket addr.
app.set('trust proxy', 1);

const opts = (windowMs, limit, message) => ({
  windowMs, limit, standardHeaders: true, legacyHeaders: false,
  message: { error: message },
});
// Broad catch-all so one IP can't flood the API (a normal session makes a
// handful of calls per page, so 600/5min is comfortable for real use).
const generalLimiter = rateLimit(opts(5 * 60 * 1000, 600, 'too many requests — slow down a moment.'));
// Tight on auth to blunt credential brute-force + OTP abuse (legit users make
// only a few auth calls).
const authLimiter = rateLimit(opts(15 * 60 * 1000, 40, 'too many attempts — try again in a few minutes.'));
// Protects the unauthenticated, cost-bearing routes (Gemini "why", lyrics
// provider) from being driven for spend/DoS on cache misses.
const costLimiter = rateLimit(opts(5 * 60 * 1000, 60, 'too many requests — slow down a moment.'));

app.use('/api', generalLimiter);
app.use('/api/auth', authLimiter);
app.use(['/api/why', '/api/lyrics'], costLimiter);

// ── Auth routes (public) ────────────────────────────────────────────
app.use('/api/auth', authRouter);

// ── Family mode (all routes require auth) ────────────────────────────
app.use('/api/family', familyRouter);

// ── Listening modes (all routes require auth) ────────────────────────
app.use('/api/modes', modesRouter);

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

app.get('/api/catalog/search', optionalAuth, async (req, res) => {
  const q = String(req.query.q ?? '').trim();
  if (!q) return res.status(400).json({ error: 'missing query' });
  const lang = req.query.lang ? String(req.query.lang) : undefined;
  const limit = Number(req.query.limit) || 20;
  // The user's languages, in priority order, for "my-languages-first" ranking.
  const userLangs = req.query.langs
    ? String(req.query.langs).split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
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
    return res.status(500).json({ error: songsRes.reason?.message ?? 'search failed' });
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
});

app.get('/api/catalog/track/:id', async (req, res) => {
  try {
    const track = await getTrackById(req.params.id);
    res.json(track);
  } catch (err) {
    const status = err.statusCode || 500;
    res.status(status).json({ error: err.message });
  }
});

app.get('/api/tracks/:id/related', async (req, res) => {
  try {
    const lang = req.query.lang ? String(req.query.lang) : undefined;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const tracks = await getRelatedTracks(req.params.id, { lang, limit });
    res.json({ tracks });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

app.get('/api/artists/lookup', async (req, res) => {
  try {
    const name    = req.query.name    ? String(req.query.name)    : undefined;
    const id      = req.query.id      ? String(req.query.id)      : undefined;
    const trackId = req.query.trackId ? String(req.query.trackId) : undefined;
    const artist = await getArtistDetails({ name, id, trackId });
    res.json({ artist });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

app.get('/api/albums/:id', async (req, res) => {
  try {
    const album = await getAlbumDetail(req.params.id);
    res.json({ album });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

app.get('/api/catalog/featured', optionalAuth, async (req, res) => {
  const lang = req.query.lang ? String(req.query.lang) : undefined;
  const limit = Number(req.query.limit) || 20;
  try {
    // Signed-in: seed the pool from the user's active mode (empty seed for
    // `everyday` → the unchanged global default). Signed-out: global default.
    let seedArtists, modeKey;
    if (req.userId) {
      const u = await pool.query('SELECT active_mode FROM users WHERE id = $1', [req.userId]);
      modeKey = u.rows[0]?.active_mode || 'everyday';
      seedArtists = modeSeedArtists(modeKey);
    }
    const results = await getFeatured({ lang, limit, seedArtists, modeKey, userId: req.userId });
    res.json({ results });
    cacheTracks(results);
  } catch (err) {
    const status = err.statusCode || 500;
    res.status(status).json({ error: err.message });
  }
});

const LYRICS_TTL_MS = 7 * 24 * 60 * 60 * 1000;  // 7 days

app.get('/api/lyrics/:track_id', async (req, res) => {
  const { track_id } = req.params;
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
    const cached = await pool.query(
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
    // configured, queue a job and tell the client to poll; otherwise it's simply
    // unavailable.
    if (generationEnabled()) {
      await saveLyrics(track_id, { source: 'pending', synced: false, payload: {} });
      const job = await enqueueLyricJob(track_id);
      if (job.status === 'queued') {
        try { await dispatchJob(track_id); }
        catch (err) { console.warn('[lyrics] dispatch failed; reaper will retry:', err.message); }
      }
      return respond({ available: false, synced: false, pending: true },
        { cacheHit: false, source: 'pending', synced: false });
    }

    await saveLyrics(track_id, { source: 'none', synced: false, payload: {} });
    return respond({ available: false, synced: false },
      { cacheHit: false, source: 'none', synced: false });
  } catch (err) {
    const status = err.statusCode || 500;
    await respond({ error: err.message },
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
    const authed = REPLICATE_WEBHOOK_SIGNING_SECRET
      ? verifyWebhookSignature(req.rawBody, req.headers, REPLICATE_WEBHOOK_SIGNING_SECRET)
      : (!!LYRICS_WEBHOOK_SECRET && req.query.token === LYRICS_WEBHOOK_SECRET);
    if (!authed) return res.status(401).json({ error: 'unauthorized' });
    const trackId = String(req.query.track_id ?? '');
    if (!trackId) return res.status(400).json({ error: 'missing track_id' });
    try {
      await completeFromPrediction(req.body, trackId);
      res.json({ ok: true });
    } catch (err) {
      console.warn('[lyrics] webhook handling failed:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

// Cron reaper (Vercel Cron → GET). Recovers stuck jobs and dispatches the queue.
// Authorized ONLY by Vercel's `Authorization: Bearer ${CRON_SECRET}` — never the
// webhook secret (which is logged by Replicate), so a webhook-secret leak can't
// drive the dispatcher. Unreachable until CRON_SECRET is set (i.e. in prod).
app.get('/api/lyrics-jobs/process', async (req, res) => {
  const bearer = (req.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const authed = !!CRON_SECRET && bearer === CRON_SECRET;
  if (!authed) return res.status(401).json({ error: 'unauthorized' });
  try {
    res.json(await processQueue());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Lyrics fetch-time analytics summary (cold p50/p95/avg, cache-hit rate, per
// source). Open in local dev; once CRON_SECRET is configured (prod) it requires
// that same bearer. e.g. GET /api/lyrics-jobs/stats?hours=24
app.get('/api/lyrics-jobs/stats', async (req, res) => {
  const bearer = (req.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const authed = !CRON_SECRET || bearer === CRON_SECRET;
  if (!authed) return res.status(401).json({ error: 'unauthorized' });
  try {
    const hours = Math.min(Math.max(Number(req.query.hours) || 24, 1), 24 * 30);
    res.json(await getLyricsStats({ hours }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const WHY_TTL_MS = 24 * 60 * 60 * 1000;  // 24 hours

app.post('/api/why', async (req, res) => {
  const { track_id, mood, recent_track_ids } = req.body ?? {};
  if (!track_id) return res.status(400).json({ error: 'missing track_id' });
  const moodKey = mood ?? 'any';
  try {
    const cached = await pool.query(
      `SELECT payload, fetched_at FROM why_cache WHERE track_id = $1 AND mood = $2`,
      [track_id, moodKey],
    );
    if (cached.rowCount && Date.now() - Number(cached.rows[0].fetched_at) < WHY_TTL_MS) {
      return res.json(cached.rows[0].payload);
    }

    const track = await getTrackById(track_id);
    let recent = [];
    if (Array.isArray(recent_track_ids) && recent_track_ids.length) {
      const ids = recent_track_ids.slice(0, 5);
      const { rows } = await pool.query(
        `SELECT id, title, artist, language FROM tracks WHERE id = ANY($1::text[])`,
        [ids],
      );
      const byId = new Map(rows.map(r => [r.id, r]));
      recent = ids.map(id => byId.get(id)).filter(Boolean);
    }

    const reason = await generateWhy({ track, mood, recent });
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
    res.status(status).json({ error: err.message });
  }
});

app.get('/api/journal', requireAuth, async (req, res) => {
  const days = Math.min(Math.max(Number(req.query.days) || 7, 1), 30);
  try {
    res.json(await getJournalEntries(req.userId, { days }));
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

app.get('/api/sonic-dna', requireAuth, async (req, res) => {
  try {
    res.json(await getSonicDna(req.userId));
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

app.post('/api/greeting', async (req, res) => {
  const { mood, track_count, languages, hour } = req.body ?? {};
  try {
    const result = await getGreeting({
      mood,
      trackCount: Number(track_count) || 0,
      languages: languages ?? {},
      hour: Number.isInteger(hour) ? hour : new Date().getHours(),
    });
    res.json(result);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

app.get('/api/library/summary', requireAuth, async (req, res) => {
  try {
    res.json(await getLibrarySummary(req.userId));
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

app.get('/api/stats/most-played', requireAuth, async (req, res) => {
  try {
    const days  = Number(req.query.days)  || 30;
    const limit = Number(req.query.limit) || 10;
    res.json({ tracks: await getMostPlayed(req.userId, { days, limit }) });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

app.get('/api/stats/top-artists', requireAuth, async (req, res) => {
  try {
    const days  = Number(req.query.days)  || 30;
    const limit = Number(req.query.limit) || 8;
    res.json({ artists: await getTopArtists(req.userId, { days, limit }) });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

app.get('/api/stats/recently-played', requireAuth, async (req, res) => {
  try {
    const limit = Number(req.query.limit) || 10;
    res.json({ tracks: await getRecentlyPlayed(req.userId, { limit }) });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

// Full listening history (paginated, newest first) for the song-history screen.
app.get('/api/history', requireAuth, async (req, res) => {
  try {
    const limit  = Math.min(Math.max(Number(req.query.limit) || 80, 1), 200);
    const before = req.query.before ? Number(req.query.before) : undefined;
    res.json(await getHistory(req.userId, { limit, before }));
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

// Windowed plays for the "music clock" — bucketed into parts of day on the client.
app.get('/api/history/clock', requireAuth, async (req, res) => {
  try {
    const days = Math.min(Math.max(Number(req.query.days) || 60, 1), 365);
    res.json({ plays: await getMusicClockPlays(req.userId, { days }) });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

app.get('/api/discover/home', async (req, res) => {
  try {
    const lang = req.query.lang ? String(req.query.lang) : undefined;
    res.json(await getDiscoverHome({ lang }));
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

app.get('/api/discover/playlist/:id', async (req, res) => {
  try {
    res.json(await getCatalogPlaylistDetail(req.params.id));
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

app.get('/api/mood/current', requireAuth, async (req, res) => {
  try {
    const snapshot = req.query.refresh === '1'
      ? await inferMood(req.userId)
      : await inferIfStale(req.userId);
    res.json(snapshot ?? { mood: null, confidence: 0, drift: 'steady', events_seen: 0 });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

app.post('/api/llm/talk', requireAuth, async (req, res) => {
  const { message, history, context } = req.body ?? {};
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'missing message' });
  }
  try {
    const enriched = await buildTalkContext(req.userId, context).catch(() => context ?? {});
    const snapshot = await inferIfStale(req.userId).catch(() => null);
    if (snapshot?.mood && snapshot.confidence >= 0.5) enriched.mood = snapshot.mood;

    const result = await generateTalk({ message, history, context: enriched });
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
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

app.get('/api/bridges/suggest', requireAuth, async (req, res) => {
  try {
    const h = Number.parseInt(req.query.hour, 10);
    const hour = Number.isInteger(h) ? h : new Date().getHours();
    res.json(await getBridgeSuggestion(req.userId, { hour }));
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
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
    res.status(err.statusCode || 500).json({ error: err.message });
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
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

app.post('/api/likes', requireAuth, async (req, res) => {
  const { track_id } = req.body ?? {};
  if (!track_id) return res.status(400).json({ error: 'missing track_id' });
  try {
    await likeTrack(req.userId, track_id);
    res.json({ ok: true });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

app.delete('/api/likes/:track_id', requireAuth, async (req, res) => {
  try {
    await unlikeTrack(req.userId, req.params.track_id);
    res.json({ ok: true });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

app.get('/api/playlists', requireAuth, async (req, res) => {
  try {
    res.json({ playlists: await listPlaylists(req.userId) });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

// MUST be declared before `/:id` — Express matches in order, so otherwise
// `getPlaylist(userId, 'auto')` would 404 instead of returning the smart sets.
app.get('/api/playlists/auto', requireAuth, async (req, res) => {
  try {
    res.json({ playlists: await getAutoPlaylists(req.userId) });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

app.get('/api/playlists/:id', requireAuth, async (req, res) => {
  try {
    res.json(await getPlaylist(req.userId, req.params.id));
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

app.post('/api/playlists', requireAuth, async (req, res) => {
  const { name, description } = req.body ?? {};
  try {
    const playlist = await createPlaylist(req.userId, { name, description });
    res.json(playlist);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

app.delete('/api/playlists/:id', requireAuth, async (req, res) => {
  try {
    await deletePlaylist(req.userId, req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

app.post('/api/playlists/:id/tracks', requireAuth, async (req, res) => {
  const { track_id } = req.body ?? {};
  if (!track_id) return res.status(400).json({ error: 'missing track_id' });
  try {
    try {
      const track = await getTrackById(track_id);
      if (track) await cacheTracks([track]);
    } catch { /* best-effort */ }
    await addTrackToPlaylist(req.userId, req.params.id, track_id);
    res.json({ ok: true });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

app.delete('/api/playlists/:id/tracks/:track_id', requireAuth, async (req, res) => {
  try {
    await removeTrackFromPlaylist(req.userId, req.params.id, req.params.track_id);
    res.json({ ok: true });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

// Cheap change cursor for collaboration polling.
app.get('/api/playlists/:id/rev', requireAuth, async (req, res) => {
  try {
    res.json(await getPlaylistRev(req.userId, req.params.id));
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

// Owner mints a share invite. body: { role?: 'editor' | 'viewer' }
app.post('/api/playlists/:id/invite', requireAuth, async (req, res) => {
  try {
    res.json(await createInvite(req.userId, req.params.id, { role: req.body?.role }));
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

// Accept a share invite → become a collaborator. (No :id — distinct path.)
app.post('/api/playlists/invite/:token/accept', requireAuth, async (req, res) => {
  try {
    res.json(await acceptInvite(req.userId, req.params.token));
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

// Remove a collaborator (owner removes anyone; a collaborator removes themselves).
app.delete('/api/playlists/:id/collaborators/:user_id', requireAuth, async (req, res) => {
  try {
    await removeCollaborator(req.userId, req.params.id, req.params.user_id);
    res.json({ ok: true });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

const EVENT_KINDS = new Set(['play', 'pause', 'skip', 'seek', 'end']);

app.post('/api/events', requireAuth, async (req, res) => {
  const { track_id, kind, position_sec, mood, language, mode } = req.body ?? {};
  if (!track_id || !EVENT_KINDS.has(kind)) {
    return res.status(400).json({ error: 'invalid track_id or kind' });
  }
  try {
    // The track must already be in our catalog cache (it's upserted whenever a
    // track is loaded/played). Check LOCALLY only — never getTrackById here: a
    // DB miss there falls through to an upstream provider call, so phantom ids
    // would become an amplification vector. Unknown id → reject, don't pollute
    // listening_events (it feeds mood/language affinity).
    const known = await pool.query('SELECT 1 FROM tracks WHERE id = $1', [track_id]);
    if (!known.rowCount) return res.status(404).json({ error: 'unknown track' });
    await pool.query(
      `INSERT INTO listening_events (user_id, track_id, ts, kind, position_sec, mood, language, mode)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [req.userId, track_id, Date.now(), kind, position_sec ?? null, mood ?? null, language ?? null, mode ?? null],
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/events/recent', requireAuth, async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 500);
  try {
    const { rows } = await pool.query(
      `SELECT id, track_id, ts, kind, position_sec, mood, language
       FROM listening_events WHERE user_id = $1 ORDER BY ts DESC LIMIT $2`,
      [req.userId, limit],
    );
    res.json({ events: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default app;
