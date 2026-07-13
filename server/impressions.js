// Impression logging + the shown-but-ignored demotion signal. We record which
// tracks a home surface DISPLAYED (per user-local day) so the ranker can learn
// what you keep ignoring — the honest version of "successive requests don't
// return identical lists" (Covington 2016's churn). Nothing here is new
// listening data; it's what we put in front of you.

import { query, pool } from './db.js';
import { clampTzOffset, localDateKey } from './tasteScore.js';

// Shown on >= this many distinct days AND never played since we first showed it
// → held out of the rotation slots for the cooldown window (anchors are exempt).
export const COOLDOWN_MIN_DAYS = 3;
export const COOLDOWN_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
// Softer than the cooldown: each unplayed shown-day multiplies the pick's score,
// so an ignored pick sinks through the rotation window before it's cut entirely.
export const PENALTY_BASE = 0.85;
const PRUNE_AGE_MS = 90 * 24 * 60 * 60 * 1000;

// Record a batch of impressions for one surface on the user's local day. One
// query; `count` climbs per session that showed the track (distinct-day count is
// what drives demotion, so a double-log is harmless).
export async function recordImpressions(userId, { surface, tzOffset, trackIds }) {
  if (!trackIds.length) return;
  const day = localDateKey(clampTzOffset(tzOffset));
  const now = Date.now();
  const params = [userId, surface, day, now];
  const values = trackIds.map((id) => {
    params.push(id);
    return `($1, $${params.length}, $2, $3, 1, $4, $4)`;
  });
  await query(
    `INSERT INTO impressions (user_id, track_id, surface, day, count, first_ts, last_ts)
     VALUES ${values.join(', ')}
     ON CONFLICT (user_id, track_id, surface, day)
     DO UPDATE SET count = impressions.count + 1, last_ts = EXCLUDED.last_ts`,
    params,
    { retries: 0 },
  );
}

// Per-track demotion signal for a surface: how many distinct days we showed a
// track that you never played since (→ score penalty), and whether it's earned a
// cooldown. Resilient — a read failure just means "no demotion", never a broken
// quick-picks response.
export async function getImpressionSignals(userId, surface, trackIds) {
  if (!trackIds.length) return new Map();
  try {
    const { rows } = await pool.query(
      `WITH shown AS (
         SELECT track_id, COUNT(DISTINCT day)::int AS shown_days,
                MIN(first_ts) AS first_ts, MAX(last_ts) AS last_ts
         FROM impressions
         WHERE user_id = $1 AND surface = $2 AND track_id = ANY($3)
         GROUP BY track_id
       )
       SELECT s.track_id, s.shown_days, s.last_ts,
              EXISTS (
                SELECT 1 FROM listening_events e
                WHERE e.user_id = $1 AND e.track_id = s.track_id
                  AND e.kind = 'play' AND e.ts >= s.first_ts
              ) AS played_since
       FROM shown s`,
      [userId, surface, trackIds],
    );
    const now = Date.now();
    const map = new Map();
    for (const r of rows) {
      const unplayedShownDays = r.played_since ? 0 : r.shown_days;
      const cooledDown = !r.played_since
        && r.shown_days >= COOLDOWN_MIN_DAYS
        && Number(r.last_ts) > now - COOLDOWN_WINDOW_MS;
      map.set(r.track_id, { unplayedShownDays, cooledDown });
    }
    return map;
  } catch (err) {
    console.warn('[impressions] signal read failed:', err?.message ?? err);
    return new Map();
  }
}

export function applyPenalty(score, unplayedShownDays) {
  return score * Math.pow(PENALTY_BASE, unplayedShownDays || 0);
}

// Best-effort retention — piggybacked on the daily cron.
export async function pruneOldImpressions() {
  await query(`DELETE FROM impressions WHERE last_ts < $1`, [Date.now() - PRUNE_AGE_MS]);
}
