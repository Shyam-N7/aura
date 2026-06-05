import express from 'express';
import { pool } from './db.js';
import { searchSongs } from './catalog.js';
import { getTrackById, cacheTracks } from './tracks.js';
import { getFeatured } from './featured.js';
import { getLyricsForTrack } from './lyrics.js';
import { generateWhy } from './prompts/why.js';
import { getJournalEntries } from './journal.js';
import { getSonicDna } from './sonicDna.js';
import { listLiked, listLikedIds, likeTrack, unlikeTrack } from './likes.js';
import { listPlaylists, getPlaylist, createPlaylist, deletePlaylist, addTrackToPlaylist, removeTrackFromPlaylist, searchPlaylists } from './playlists.js';
import { getLibrarySummary } from './library.js';
import { getGreeting } from './greeting.js';
import { getMostPlayed, getTopArtists, getRecentlyPlayed } from './stats.js';
import { getDiscoverHome } from './discover.js';
import { getCatalogPlaylistDetail } from './catalog.js';
import { getBridgeTracks } from './bridges.js';
import { getRelatedTracks } from './related.js';
import { getArtistDetails, getAlbumTracks } from './artists.js';
import { generateTalk } from './prompts/talk.js';
import { getCurrentMood, inferMood, inferIfStale } from './mood.js';
import authRouter from './auth.js';
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
  if (req.body && typeof req.body === 'object') return next();
  express.json()(req, res, next);
});

// ── Auth routes (public) ────────────────────────────────────────────
app.use('/api/auth', authRouter);

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

app.get('/api/catalog/search', optionalAuth, async (req, res) => {
  const q = String(req.query.q ?? '').trim();
  if (!q) return res.status(400).json({ error: 'missing query' });
  const lang = req.query.lang ? String(req.query.lang) : undefined;
  const limit = Number(req.query.limit) || 20;
  const [tracksRes, plRes] = await Promise.allSettled([
    searchSongs(q, { lang, limit }),
    req.userId ? searchPlaylists(req.userId, q, { limit: 5 }) : Promise.resolve([]),
  ]);
  const results   = tracksRes.status === 'fulfilled' ? tracksRes.value : [];
  const playlists = plRes.status     === 'fulfilled' ? plRes.value     : [];
  const error     = tracksRes.status === 'rejected' && plRes.status === 'rejected'
    ? tracksRes.reason?.message ?? 'search failed'
    : null;
  if (error) return res.status(500).json({ error });
  res.json({ results, playlists });
  if (results.length) cacheTracks(results);
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
    const tracks = await getRelatedTracks(req.params.id, { lang });
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

app.get('/api/albums/:id/tracks', async (req, res) => {
  try {
    const tracks = await getAlbumTracks(req.params.id);
    res.json({ tracks });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

app.get('/api/catalog/featured', async (req, res) => {
  const lang = req.query.lang ? String(req.query.lang) : undefined;
  const limit = Number(req.query.limit) || 20;
  try {
    const results = await getFeatured({ lang, limit });
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
  try {
    const cached = await pool.query(
      `SELECT source, synced, payload, fetched_at FROM lyrics WHERE track_id = $1`,
      [track_id],
    );
    if (cached.rowCount && Date.now() - Number(cached.rows[0].fetched_at) < LYRICS_TTL_MS) {
      const row = cached.rows[0];
      return res.json({
        available: row.source !== 'none',
        synced: row.synced,
        source: row.source,
        ...(row.payload ?? {}),
      });
    }
    const track = await getTrackById(track_id);
    const result = await getLyricsForTrack({
      id: track.id,
      title: track.title,
      artist: track.artist,
      durationSec: track.durationSec,
      language: track.language,
    });
    const payload = {
      ...(result.lines ? { lines: result.lines } : {}),
      ...(result.plain ? { plain: result.plain } : {}),
      ...(result.plain_en ? { plain_en: result.plain_en } : {}),
      has_english: !!result.has_english,
    };
    await pool.query(
      `INSERT INTO lyrics (track_id, source, synced, payload, fetched_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (track_id) DO UPDATE SET
         source = EXCLUDED.source, synced = EXCLUDED.synced,
         payload = EXCLUDED.payload, fetched_at = EXCLUDED.fetched_at`,
      [track_id, result.source ?? 'none', !!result.synced, JSON.stringify(payload), Date.now()],
    );
    res.json(result);
  } catch (err) {
    const status = err.statusCode || 500;
    res.status(status).json({ error: err.message });
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

async function buildTalkContext(userId, clientContext) {
  const { rows: recentRows } = await pool.query(`
    SELECT t.title, t.artist, MAX(e.ts) AS last_ts
    FROM listening_events e
    JOIN tracks t ON t.id = e.track_id
    WHERE e.user_id = $1 AND e.kind = 'play'
    GROUP BY t.title, t.artist
    ORDER BY last_ts DESC
    LIMIT 8
  `, [userId]);
  const { rows: likedRows } = await pool.query(`
    SELECT t.title, t.artist
    FROM liked_tracks lt
    JOIN tracks t ON t.id = lt.track_id
    WHERE lt.user_id = $1
    ORDER BY lt.liked_at DESC
    LIMIT 10
  `, [userId]);
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const { rows: langRows } = await pool.query(`
    SELECT language, COUNT(*)::int AS plays
    FROM listening_events
    WHERE user_id = $1 AND kind = 'play' AND language IS NOT NULL AND ts > $2
    GROUP BY language
    ORDER BY plays DESC
    LIMIT 5
  `, [userId, cutoff]);
  const totalLangPlays = langRows.reduce((s, r) => s + r.plays, 0);
  const langAffinity = langRows.map(r => {
    const pct = totalLangPlays ? Math.round((r.plays / totalLangPlays) * 100) : 0;
    return `${r.language} ${pct}%`;
  });

  return {
    ...(clientContext ?? {}),
    recentListens: recentRows.map(r => `${r.title} — ${r.artist}`),
    likedSample:   likedRows.map(r => `${r.title} — ${r.artist}`),
    langAffinity,
  };
}

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
        // tracks anchored on the same artist so playback flows naturally.
        if (tracks.length === 1 && tracks[0].artist) {
          try {
            const radio = await searchSongs(`${tracks[0].artist} ${tracks[0].language ?? ''}`.trim(), {
              lang:  result.action.language || tracks[0].language || undefined,
              limit: 4,
            });
            // Filter out the seed track + dedup; keep up to 3 extras.
            const extras = radio
              .filter(t => t.id !== tracks[0].id)
              .slice(0, 3);
            tracks = [...tracks, ...extras];
          } catch (radioErr) {
            console.warn('[talk] artist radio failed:', radioErr.message);
          }
        }
        cacheTracks(tracks);
      } catch (searchErr) {
        console.warn('[talk] catalog search failed:', searchErr.message);
      }
    }
    res.json({ reply: result.reply, action: result.action, tracks });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

app.get('/api/bridges/:from/:to', async (req, res) => {
  try {
    const steps = Number(req.query.steps) || 5;
    const tracks = await getBridgeTracks({ from: req.params.from, to: req.params.to, steps });
    res.json({ from: req.params.from, to: req.params.to, tracks });
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

const EVENT_KINDS = new Set(['play', 'pause', 'skip', 'seek', 'end']);

app.post('/api/events', requireAuth, async (req, res) => {
  const { track_id, kind, position_sec, mood, language } = req.body ?? {};
  if (!track_id || !EVENT_KINDS.has(kind)) {
    return res.status(400).json({ error: 'invalid track_id or kind' });
  }
  try {
    await pool.query(
      `INSERT INTO listening_events (user_id, track_id, ts, kind, position_sec, mood, language)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [req.userId, track_id, Date.now(), kind, position_sec ?? null, mood ?? null, language ?? null],
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
