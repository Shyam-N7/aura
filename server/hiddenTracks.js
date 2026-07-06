// Explicit negative feedback — "don't show this again." A hidden track is a hard
// exclusion from every made-for-you pick (mixes + auto-radio, via tasteScore's
// suppressed set), with a visible, undoable list in Settings. This is the
// contract skip-shelving deliberately isn't: shelving is implicit and
// self-healing; hiding is explicit and permanent until the user undoes it.
// Hiding never touches likes, playlists or history — it only stops us PICKING
// the track; the user can still play it themselves from anywhere.

import { pool, query } from './db.js';
import { mapTrackRow } from './stats.js';

export async function hideTrack(userId, trackId) {
  if (!trackId || typeof trackId !== 'string' || trackId.length > 64) {
    const err = new Error('invalid track id');
    err.statusCode = 400;
    throw err;
  }
  await pool.query(
    `INSERT INTO hidden_tracks (user_id, track_id, hidden_at) VALUES ($1, $2, $3)
     ON CONFLICT (user_id, track_id) DO NOTHING`,
    [userId, trackId, Date.now()],
  );
}

export async function unhideTrack(userId, trackId) {
  await pool.query(
    `DELETE FROM hidden_tracks WHERE user_id = $1 AND track_id = $2`,
    [userId, trackId],
  );
}

// Newest-hidden first, joined for display; a hidden id whose track row vanished
// still shows (title falls back to the id) so it can always be unhidden.
export async function listHidden(userId) {
  const { rows } = await query(
    `SELECT h.track_id, h.hidden_at,
            t.id, t.title, t.artist, t.album, t.language, t.duration_sec, t.stream_url, t.raw
     FROM hidden_tracks h
     LEFT JOIN tracks t ON t.id = h.track_id
     WHERE h.user_id = $1
     ORDER BY h.hidden_at DESC`,
    [userId],
  );
  return rows.map(r => ({
    ...(r.id ? mapTrackRow(r) : { id: r.track_id, title: r.track_id, artist: '' }),
    hiddenAt: Number(r.hidden_at),
  }));
}
