// Personalized home surfaces, served honestly — built on the SAME taste engine
// as quick-picks and the mixes (tasteScore.js), so every pick is the user's own
// listening and every claim ships a one-sentence receipt. The home shelves that
// used to slice the editorial featured pool (hero / new-for-you / stations) get
// real signal here; when a user has too little history, each function returns
// null and the client keeps its honest featured fallback — never a fabricated
// "for you".

import { pool } from './db.js';
import {
  getScoredTracks,
  getSuppressedTrackIds,
  clampTzOffset,
  localDateKey,
  HALF_LIFE_CURRENT_DAYS,
} from './tasteScore.js';
import { getTopArtists, getMostPlayed, mapTrackRow } from './stats.js';
import { capPerArtist } from './related.js';
import { pickDaily } from './featured.js';

// Enough listening to personalize the hero without it reading as a fluke.
const HERO_MIN_POOL = 3;
// The hero rotates daily across the user's current top few, so it stays "you"
// but never sits static (the "same album for a month" complaint).
const HERO_ROTATE_TOP = 6;
// Stations: distinct seeds a radio can start from.
const STATION_COUNT = 6;

// One plain sentence, straight from the numbers that ranked the pick.
function heroReason(r) {
  if (r.completions >= 3) return `you finished this ${r.completions}× lately`;
  if (r.liked) return 'a favourite of yours';
  if (r.completions >= 1) return 'you keep coming back to this';
  if (r.plays >= 3) return `${r.plays} plays this month`;
  return 'from your rotation';
}

// The day's hero, drawn from the user's own top tracks and rotated daily among
// the top few (deterministic per user-local day, so a reload is stable). Returns
// null below the history floor — the client then shows a featured pick.
export async function getPersonalHero(userId, { tzOffset = 0 } = {}) {
  const suppressed = await getSuppressedTrackIds(userId);
  const scored = await getScoredTracks(userId, {
    halfLifeDays: HALF_LIFE_CURRENT_DAYS,
    windowDays: 45,
    minPlays: 2,
    limit: 24,
  });
  const pool = scored.filter(r => !suppressed.has(r.id));
  if (pool.length < HERO_MIN_POOL) {
    return null;
  }
  const editionKey = localDateKey(clampTzOffset(tzOffset));
  const pick = pickDaily(pool.slice(0, HERO_ROTATE_TOP), 1, `${userId}|${editionKey}|hero`)[0];
  return {
    track: { ...mapTrackRow(pick), explicit: pick.raw?.explicit === true },
    reason: heroReason(pick),
  };
}

// Real "stations": one radio seed per distinct top artist (each tile plays a
// song-seeded radio via the client's existing getRelated/auto-radio). Seeds are
// the user's most-played artists, deduped, with the artist's sample track as the
// tile's face. Null below the floor → featured fallback on the client.
export async function getStations(userId) {
  const artists = await getTopArtists(userId, { days: 60, limit: STATION_COUNT + 2 });
  const suppressed = await getSuppressedTrackIds(userId);
  const seen = new Set();
  const stations = [];
  for (const a of artists) {
    const t = a.sampleTrack;
    if (!t?.id || suppressed.has(t.id) || seen.has(t.id)) {
      continue;
    }
    seen.add(t.id);
    stations.push({
      seedId: t.id,
      title: t.title,
      artist: a.artist,
      imageUrl: t.imageUrl ?? null,
      language: t.language ?? null,
      reason: `radio from ${a.artist}`,
    });
    if (stations.length >= STATION_COUNT) {
      break;
    }
  }
  // Sparse artist history: seed a couple of stations from most-played tracks.
  if (stations.length < 2) {
    const most = await getMostPlayed(userId, { days: 60, limit: STATION_COUNT });
    for (const t of most) {
      if (seen.has(t.id) || suppressed.has(t.id)) {
        continue;
      }
      seen.add(t.id);
      stations.push({
        seedId: t.id,
        title: t.title,
        artist: t.artist,
        imageUrl: t.imageUrl ?? null,
        language: t.language ?? null,
        reason: 'a station from this',
      });
      if (stations.length >= STATION_COUNT) {
        break;
      }
    }
  }
  return stations.length ? { stations } : null;
}

// "New for you": genuine discovery from the user's OWN similarity graph — tracks
// adjacent to their top songs that they've never played, liked, or hidden.
// Owned data only (the graph accumulates from every station we build), ordered
// by graph closeness, capped per artist. Null when the graph is still too thin —
// the client keeps the featured fallback, and we never label editorial picks
// "for you".
export async function getNewForYou(userId, { limit = 8 } = {}) {
  const scored = await getScoredTracks(userId, {
    halfLifeDays: HALF_LIFE_CURRENT_DAYS,
    windowDays: 60,
    minPlays: 2,
    limit: 20,
  });
  const seedIds = scored.map(r => r.id);
  if (!seedIds.length) {
    return null;
  }
  const { rows } = await pool.query(
    `SELECT t.id, t.title, t.artist, t.album, t.language, t.duration_sec,
            t.stream_url, t.raw, MIN(ts.rank) AS rank
     FROM track_similarity ts
     JOIN tracks t ON t.id = ts.related_track_id
     WHERE ts.source_track_id = ANY($2)
       AND t.stream_url IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM listening_events e WHERE e.user_id = $1 AND e.track_id = t.id)
       AND NOT EXISTS (SELECT 1 FROM liked_tracks   lt WHERE lt.user_id = $1 AND lt.track_id = t.id)
       AND NOT EXISTS (SELECT 1 FROM hidden_tracks  h  WHERE h.user_id  = $1 AND h.track_id  = t.id)
     GROUP BY t.id
     ORDER BY rank ASC
     LIMIT $3`,
    [userId, seedIds, limit * 3],
  );
  if (!rows.length) {
    return null;
  }
  const tracks = capPerArtist(rows, 1)
    .slice(0, limit)
    .map(r => ({ ...mapTrackRow(r), explicit: r.raw?.explicit === true }));
  return tracks.length ? { tracks } : null;
}
