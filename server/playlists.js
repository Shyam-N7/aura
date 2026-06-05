import { pool } from './db.js';

function newId() {
  return 'pl_' + Math.random().toString(36).slice(2, 10);
}

export async function listPlaylists(userId) {
  // Pull each playlist plus a track count and a cover-image hint (from the
  // cover_track_id's cached row, or null if not set / track not cached).
  const { rows } = await pool.query(`
    SELECT p.id, p.name, p.description, p.cover_track_id, p.created_at, p.updated_at,
           COALESCE(c.cnt, 0)::int AS track_count,
           t.raw                   AS cover_raw
    FROM playlists p
    LEFT JOIN (
      SELECT playlist_id, COUNT(*) AS cnt FROM playlist_tracks GROUP BY playlist_id
    ) c ON c.playlist_id = p.id
    LEFT JOIN tracks t ON t.id = p.cover_track_id
    WHERE p.user_id = $1
    ORDER BY p.created_at DESC
  `, [userId]);
  return rows.map(r => ({
    id:          r.id,
    name:        r.name,
    description: r.description,
    trackCount:  r.track_count,
    coverImageUrl: r.cover_raw?.imageUrl ?? null,
    updatedAt:   Number(r.updated_at),
  }));
}

export async function searchPlaylists(userId, q, { limit = 5 } = {}) {
  const term = String(q ?? '').trim();
  if (!term) return [];
  // Match playlists by name OR by containing a track whose title/artist matches.
  // EXISTS keeps the row 1:1 with playlists (no duplication on multi-track matches).
  const { rows } = await pool.query(
    `SELECT p.id, p.name, p.cover_track_id, p.updated_at,
            COALESCE(c.cnt, 0)::int AS track_count,
            t.raw                   AS cover_raw
     FROM playlists p
     LEFT JOIN (
       SELECT playlist_id, COUNT(*) AS cnt FROM playlist_tracks GROUP BY playlist_id
     ) c ON c.playlist_id = p.id
     LEFT JOIN tracks t ON t.id = p.cover_track_id
     WHERE p.user_id = $1
       AND (p.name ILIKE $2
        OR EXISTS (
          SELECT 1 FROM playlist_tracks pt
          JOIN tracks tr ON tr.id = pt.track_id
          WHERE pt.playlist_id = p.id
            AND (tr.title ILIKE $2 OR tr.artist ILIKE $2)
        ))
     ORDER BY p.updated_at DESC
     LIMIT $3`,
    [userId, `%${term}%`, limit],
  );
  return rows.map(r => ({
    id:            r.id,
    name:          r.name,
    trackCount:    r.track_count,
    coverImageUrl: r.cover_raw?.imageUrl ?? null,
    updatedAt:     Number(r.updated_at),
  }));
}

export async function getPlaylist(userId, id) {
  const { rows: meta } = await pool.query(
    `SELECT p.id, p.name, p.description, p.cover_track_id, p.updated_at,
            t.raw AS cover_raw
     FROM playlists p
     LEFT JOIN tracks t ON t.id = p.cover_track_id
     WHERE p.user_id = $1 AND p.id = $2`,
    [userId, id],
  );
  if (meta.length === 0) {
    const err = new Error('playlist not found');
    err.statusCode = 404;
    throw err;
  }
  const { rows: trackRows } = await pool.query(
    `SELECT t.id, t.title, t.artist, t.album, t.language, t.duration_sec, t.stream_url, t.raw,
            pt.position, pt.added_at
     FROM playlist_tracks pt
     LEFT JOIN tracks t ON t.id = pt.track_id
     WHERE pt.playlist_id = $1
     ORDER BY pt.position ASC`,
    [id],
  );
  const tracks = trackRows
    .filter(r => r.id != null)
    .map(r => ({
      id:          r.id,
      title:       r.title,
      artist:      r.artist,
      album:       r.album,
      language:    r.language,
      durationSec: r.duration_sec,
      streamUrl:   r.stream_url,
      imageUrl:    r.raw?.imageUrl ?? null,
    }));
  const row = meta[0];
  return {
    id:            row.id,
    name:          row.name,
    description:   row.description,
    trackCount:    tracks.length,
    coverImageUrl: row.cover_raw?.imageUrl ?? null,
    updatedAt:     Number(row.updated_at),
    tracks,
  };
}

export async function createPlaylist(userId, { name, description = null }) {
  const id = newId();
  const ts = Date.now();
  const trimmed = String(name ?? '').trim();
  if (!trimmed) {
    const err = new Error('playlist name is required');
    err.statusCode = 400;
    throw err;
  }
  await pool.query(
    `INSERT INTO playlists (id, user_id, name, description, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $5)`,
    [id, userId, trimmed, description, ts],
  );
  return { id, name: trimmed, description, trackCount: 0, coverImageUrl: null, updatedAt: ts };
}

export async function deletePlaylist(userId, id) {
  // CASCADE on playlist_tracks cleans the join rows automatically.
  const { rowCount } = await pool.query(
    `DELETE FROM playlists WHERE user_id = $1 AND id = $2`,
    [userId, id],
  );
  if (rowCount === 0) {
    const err = new Error('playlist not found');
    err.statusCode = 404;
    throw err;
  }
}

export async function addTrackToPlaylist(userId, playlistId, trackId) {
  // Verify the playlist belongs to this user.
  const { rows: owner } = await pool.query(
    `SELECT id FROM playlists WHERE user_id = $1 AND id = $2`,
    [userId, playlistId],
  );
  if (owner.length === 0) {
    const err = new Error('playlist not found');
    err.statusCode = 404;
    throw err;
  }
  const ts = Date.now();
  // Append at end: position = max + 1, starting at 0 for empty playlist.
  // ON CONFLICT DO NOTHING means a duplicate add inserts 0 rows — we detect
  // that via rowCount and surface a 409 so the UI can show "already in …".
  const ins = await pool.query(
    `INSERT INTO playlist_tracks (playlist_id, track_id, position, added_at)
     SELECT $1, $2, COALESCE(MAX(position), -1) + 1, $3
     FROM playlist_tracks
     WHERE playlist_id = $1
     ON CONFLICT (playlist_id, track_id) DO NOTHING`,
    [playlistId, trackId, ts],
  );
  if (ins.rowCount === 0) {
    const { rows } = await pool.query(
      `SELECT name FROM playlists WHERE user_id = $1 AND id = $2`,
      [userId, playlistId],
    );
    const name = rows[0]?.name ?? 'this playlist';
    const err = new Error(`already in ${name.toLowerCase()}`);
    err.statusCode = 409;
    err.code = 'duplicate';
    throw err;
  }
  // Touch updated_at; set cover_track_id only if not already set.
  await pool.query(
    `UPDATE playlists SET
       updated_at = $2,
       cover_track_id = COALESCE(cover_track_id, $3)
     WHERE user_id = $1 AND id = $4`,
    [userId, ts, trackId, playlistId],
  );
}

export async function removeTrackFromPlaylist(userId, playlistId, trackId) {
  // Verify the playlist belongs to this user.
  const { rows: owner } = await pool.query(
    `SELECT id FROM playlists WHERE user_id = $1 AND id = $2`,
    [userId, playlistId],
  );
  if (owner.length === 0) {
    const err = new Error('playlist not found');
    err.statusCode = 404;
    throw err;
  }
  await pool.query(
    `DELETE FROM playlist_tracks WHERE playlist_id = $1 AND track_id = $2`,
    [playlistId, trackId],
  );
  // If the removed track was the cover, fall back to whichever track is at position 0.
  await pool.query(
    `UPDATE playlists SET
       cover_track_id = (SELECT track_id FROM playlist_tracks WHERE playlist_id = $1 ORDER BY position ASC LIMIT 1),
       updated_at = $2
     WHERE user_id = $3 AND id = $1 AND cover_track_id = $4`,
    [playlistId, Date.now(), userId, trackId],
  );
}
