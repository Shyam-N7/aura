import { pool } from './db.js';

export async function getLibrarySummary(userId) {
  const { rows: stats } = await pool.query(`
    WITH per_day AS (
      SELECT track_id,
             (ts / 86400000) AS day_bucket,
             MAX(position_sec) AS max_pos
      FROM listening_events
      WHERE user_id = $1 AND kind IN ('pause','skip','end') AND position_sec IS NOT NULL
      GROUP BY track_id, day_bucket
    )
    SELECT
      (SELECT COUNT(DISTINCT track_id) FROM listening_events WHERE user_id = $1 AND kind = 'play')::int AS tracks_played,
      COALESCE((SELECT SUM(max_pos) FROM per_day), 0)::float                                            AS total_seconds
  `, [userId]);
  const { rows: langRows } = await pool.query(`
    SELECT language, COUNT(*)::int AS plays
    FROM listening_events
    WHERE user_id = $1 AND kind = 'play' AND language IS NOT NULL
    GROUP BY language
    ORDER BY plays DESC
    LIMIT 1
  `, [userId]);
  const { rows: likedRows } = await pool.query(`SELECT COUNT(*)::int AS n FROM liked_tracks WHERE user_id = $1`, [userId]);
  const { rows: plRows }    = await pool.query(`SELECT COUNT(*)::int AS n FROM playlists WHERE user_id = $1`, [userId]);

  return {
    tracksPlayed:     Number(stats[0].tracks_played) || 0,
    minutesListened:  Math.round(Number(stats[0].total_seconds) / 60),
    topLanguage:      langRows[0]?.language ?? null,
    likedCount:       likedRows[0]?.n ?? 0,
    playlistCount:    plRows[0]?.n ?? 0,
  };
}
