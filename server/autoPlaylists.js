// Auto-playlists — smart sets generated on-demand from listening_events. These
// are pure SQL aggregations over an already-indexed table (no LLM cost), so we
// compute them per-request rather than caching/materialising like journal/why.
// Every set INNER JOINs tracks so only playable, fully-shaped rows come back,
// and thin sets are dropped so cold-start users never see a 1-track shelf.

import { pool } from './db.js';
import { cutoffMs, mapTrackRow } from './stats.js';

const MIN_SET = 5;        // hide sets thinner than this
const DEFAULT_LIMIT = 25;

// "On repeat" — most-played in the last ~2 weeks, floored so a single play
// doesn't qualify.
async function getOnRepeat(userId, { days = 14, minPlays = 2, limit = DEFAULT_LIMIT } = {}) {
  const { rows } = await pool.query(
    `SELECT t.id, t.title, t.artist, t.album, t.language, t.duration_sec, t.stream_url, t.raw,
            COUNT(*)::int AS plays, MAX(e.ts) AS last_ts
     FROM listening_events e
     JOIN tracks t ON t.id = e.track_id
     WHERE e.user_id = $1 AND e.kind = 'play' AND e.ts > $2
     GROUP BY t.id
     HAVING COUNT(*) >= $3
     ORDER BY plays DESC, last_ts DESC
     LIMIT $4`,
    [userId, cutoffMs(days), minPlays, limit],
  );
  return rows.map(mapTrackRow);
}

// "Bring it back" — tracks the user played often (>= minPlays all-time) but
// hasn't returned to in a while (last play older than dormantWeeks). Ordered by
// historical play count, then by most-recent-of-the-dormant.
async function getNostalgic(userId, { dormantWeeks = 4, minPlays = 3, limit = DEFAULT_LIMIT } = {}) {
  const dormantCutoff = Date.now() - dormantWeeks * 7 * 24 * 60 * 60 * 1000;
  const { rows } = await pool.query(
    `SELECT t.id, t.title, t.artist, t.album, t.language, t.duration_sec, t.stream_url, t.raw,
            COUNT(*)::int AS plays, MAX(e.ts) AS last_ts
     FROM listening_events e
     JOIN tracks t ON t.id = e.track_id
     WHERE e.user_id = $1 AND e.kind = 'play'
     GROUP BY t.id
     HAVING COUNT(*) >= $2 AND MAX(e.ts) < $3
     ORDER BY plays DESC, last_ts DESC
     LIMIT $4`,
    [userId, minPlays, dormantCutoff, limit],
  );
  return rows.map(mapTrackRow);
}

function descriptor(id, name, description, tracks) {
  return {
    id,
    kind: 'auto',
    name,
    description,
    tracks,
    trackCount: tracks.length,
    coverImageUrl: tracks.find(t => t.imageUrl)?.imageUrl ?? null,
  };
}

// Runs the sets in parallel and returns only the ones with enough tracks to feel
// like a real playlist. Copy is in AURA's lowercase voice; the UI renders these
// read-only, distinct from user playlists.
export async function getAutoPlaylists(userId) {
  const [onRepeat, nostalgic] = await Promise.all([
    getOnRepeat(userId),
    getNostalgic(userId),
  ]);
  const sets = [];
  if (onRepeat.length >= MIN_SET) {
    sets.push(descriptor('auto:on-repeat', 'on repeat', 'what you keep coming back to lately', onRepeat));
  }
  if (nostalgic.length >= MIN_SET) {
    sets.push(descriptor('auto:nostalgic', 'bring it back', 'you used to love these — time for a revisit', nostalgic));
  }
  return sets;
}
