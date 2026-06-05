import { pool } from './db.js';

// Convert "days back from now" to a unix-ms cutoff. Caller passes days.
function cutoffMs(days) {
  return Date.now() - days * 24 * 60 * 60 * 1000;
}

// Shape: same as catalog tracks (id, title, artist, album, language, durationSec,
// streamUrl, imageUrl) so HomeScreen shelves can reuse the same card components.
function mapTrackRow(r) {
  return {
    id:          r.id,
    title:       r.title,
    artist:      r.artist,
    album:       r.album,
    language:    r.language,
    durationSec: r.duration_sec,
    streamUrl:   r.stream_url,
    imageUrl:    r.raw?.imageUrl ?? null,
  };
}

export async function getMostPlayed(userId, { days = 30, limit = 10 } = {}) {
  const { rows } = await pool.query(
    `SELECT t.id, t.title, t.artist, t.album, t.language, t.duration_sec, t.stream_url, t.raw,
            COUNT(*)::int AS plays
     FROM listening_events e
     JOIN tracks t ON t.id = e.track_id
     WHERE e.user_id = $1 AND e.kind = 'play' AND e.ts > $2
     GROUP BY t.id
     ORDER BY plays DESC, MAX(e.ts) DESC
     LIMIT $3`,
    [userId, cutoffMs(days), limit],
  );
  return rows.map(r => ({ ...mapTrackRow(r), playCount: r.plays }));
}

export async function getTopArtists(userId, { days = 30, limit = 8 } = {}) {
  // Two-stage aggregation: count plays per (artist, track), pick top track per
  // artist by play count, then rank artists by total plays. Nested window
  // functions in ORDER BY aren't supported in Postgres, hence the CTEs.
  const { rows } = await pool.query(
    `WITH play_counts AS (
       SELECT t.artist, t.id, COUNT(*)::int AS plays
       FROM listening_events e
       JOIN tracks t ON t.id = e.track_id
       WHERE e.user_id = $1 AND e.kind = 'play' AND e.ts > $2 AND t.artist IS NOT NULL
       GROUP BY t.artist, t.id
     ),
     artist_totals AS (
       SELECT artist, SUM(plays)::int AS artist_plays
       FROM play_counts
       GROUP BY artist
     ),
     top_per_artist AS (
       SELECT artist, id, plays,
              ROW_NUMBER() OVER (PARTITION BY artist ORDER BY plays DESC) AS rn
       FROM play_counts
     )
     SELECT a.artist, a.artist_plays,
            t.id, t.title, t.album, t.language, t.duration_sec, t.stream_url, t.raw
     FROM artist_totals a
     JOIN top_per_artist tp ON tp.artist = a.artist AND tp.rn = 1
     JOIN tracks t ON t.id = tp.id
     ORDER BY a.artist_plays DESC
     LIMIT $3`,
    [userId, cutoffMs(days), limit],
  );
  return rows.map(r => ({
    artist:      r.artist,
    playCount:   Number(r.artist_plays),
    sampleTrack: mapTrackRow(r),
  }));
}

export async function getRecentlyPlayed(userId, { limit = 10 } = {}) {
  const { rows } = await pool.query(
    `SELECT DISTINCT ON (t.id)
            t.id, t.title, t.artist, t.album, t.language, t.duration_sec, t.stream_url, t.raw,
            e.ts AS played_at
     FROM listening_events e
     JOIN tracks t ON t.id = e.track_id
     WHERE e.user_id = $1 AND e.kind = 'play'
     ORDER BY t.id, e.ts DESC`,
    [userId],
  );
  // SQL DISTINCT ON returns one row per track; sort the result by recency and
  // cap at limit.
  return rows
    .sort((a, b) => Number(b.played_at) - Number(a.played_at))
    .slice(0, limit)
    .map(mapTrackRow);
}
