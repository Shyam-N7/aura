import { pool, query } from './db.js';
import { getTrackById, cacheTracks } from './tracks.js';

function rowToTrack(row) {
  const raw = row.raw ?? {};
  return {
    id:          row.id,
    title:       row.title,
    artist:      row.artist,
    album:       row.album,
    language:    row.language,
    durationSec: row.duration_sec,
    streamUrl:   row.stream_url,
    imageUrl:    raw.imageUrl ?? null,
  };
}

export async function listLiked(userId) {
  const { rows } = await query(
    `SELECT l.track_id, l.liked_at,
            t.id, t.title, t.artist, t.album, t.language, t.duration_sec,
            t.stream_url, t.raw
     FROM liked_tracks l
     LEFT JOIN tracks t ON t.id = l.track_id
     WHERE l.user_id = $1
     ORDER BY l.liked_at DESC`,
    [userId],
  );
  return rows.map(r => ({
    ...rowToTrack(r),
    liked_at: Number(r.liked_at),
  }));
}

export async function listLikedIds(userId) {
  const { rows } = await query(
    `SELECT track_id FROM liked_tracks WHERE user_id = $1`,
    [userId],
  );
  return rows.map(r => r.track_id);
}

export async function likeTrack(userId, trackId) {
  // Make sure the track row is cached so the joined list has data.
  try {
    const track = await getTrackById(trackId);
    if (track) await cacheTracks([track]);
  } catch (err) {
    // Track lookup failure isn't fatal — the like row can still be created.
    console.warn('[likes] track cache failed for', trackId, err.message);
  }
  await pool.query(
    `INSERT INTO liked_tracks (user_id, track_id, liked_at) VALUES ($1, $2, $3)
     ON CONFLICT (user_id, track_id) DO NOTHING`,
    [userId, trackId, Date.now()],
  );
}

export async function unlikeTrack(userId, trackId) {
  await pool.query(
    `DELETE FROM liked_tracks WHERE user_id = $1 AND track_id = $2`,
    [userId, trackId],
  );
}
