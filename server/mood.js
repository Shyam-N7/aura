// Mood inference: read the listener's recent listening events, classify their
// current mood via Gemini, cache as a snapshot. Other features (TalkAura,
// Bridges, Why-this) read getCurrentMood / inferIfStale to stay in sync.

import { pool, query } from './db.js';
import { generateMoodInference } from './prompts/moodInfer.js';

// Mood inference is an LLM call, so it's the expensive part of this feature.
// Keep it to roughly a few-hours cadence rather than every handful of tracks:
// re-infer only after a couple hours OR a large run of new plays.
const STALE_EVENTS  = 120;                // re-infer once 120 new plays have arrived
const STALE_AGE_MS  = 2 * 60 * 60 * 1000; // or after 2 hours
const WINDOW_SIZE   = 30;                 // events fed to the LLM

async function totalPlayCount(userId) {
  const { rows } = await query(
    `SELECT COUNT(*)::int AS n FROM listening_events WHERE user_id = $1 AND kind = 'play'`,
    [userId],
  );
  return rows[0]?.n ?? 0;
}

export async function getCurrentMood(userId) {
  const { rows } = await query(`
    SELECT id, ts, mood, confidence, drift, reason, events_seen
    FROM mood_snapshots
    WHERE user_id = $1
    ORDER BY ts DESC
    LIMIT 1
  `, [userId]);
  return rows[0] ?? null;
}

async function isStale(userId, snapshot) {
  if (!snapshot) return true;
  if (Date.now() - Number(snapshot.ts) > STALE_AGE_MS) return true;
  const plays = await totalPlayCount(userId);
  return plays - snapshot.events_seen >= STALE_EVENTS;
}

export async function inferMood(userId) {
  const { rows: events } = await query(`
    SELECT e.ts, e.kind, e.position_sec,
           t.title, t.artist, t.language
    FROM listening_events e
    JOIN tracks t ON t.id = e.track_id
    WHERE e.user_id = $1 AND e.kind IN ('play','skip','end')
    ORDER BY e.ts DESC
    LIMIT $2
  `, [userId, WINDOW_SIZE]);

  if (events.length === 0) return null;

  const result = await generateMoodInference({ events });
  const playsTotal = await totalPlayCount(userId);
  const { rows } = await pool.query(`
    INSERT INTO mood_snapshots (user_id, ts, mood, confidence, drift, reason, events_seen)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING id, ts, mood, confidence, drift, reason, events_seen
  `, [userId, Date.now(), result.mood, result.confidence, result.drift, result.reason ?? null, playsTotal]);
  return rows[0];
}

// Forced refresh (?refresh=1) but throttled per user: if the latest snapshot is
// younger than REFRESH_MIN_AGE_MS, return it rather than burning another Gemini
// call. Stops a single account from driving unbounded mood inferences. (security: M4)
const REFRESH_MIN_AGE_MS = 2 * 60 * 1000;

export async function refreshMood(userId) {
  const latest = await getCurrentMood(userId);
  if (latest && Date.now() - Number(latest.ts) < REFRESH_MIN_AGE_MS) return latest;
  return inferMood(userId);
}

// A mood-inference claim is valid this long — long enough to cover a slow Gemini
// call, short enough that a crashed holder self-releases. (parallel-usage hygiene)
const INFER_CLAIM_MS = 30 * 1000;

export async function inferIfStale(userId) {
  const latest = await getCurrentMood(userId);
  if (!(await isStale(userId, latest))) return latest;
  // Claim the inference atomically so two devices that cross the threshold together
  // don't both call Gemini. The loser returns the existing snapshot; the winner's
  // fresh snapshot (with updated events_seen) makes subsequent calls non-stale.
  // The claim self-expires after INFER_CLAIM_MS so a crashed holder can't wedge it.
  const now = Date.now();
  const claim = await pool.query(
    `UPDATE users SET mood_inferring_at = $2
      WHERE id = $1 AND (mood_inferring_at IS NULL OR mood_inferring_at < $3)
      RETURNING id`,
    [userId, now, now - INFER_CLAIM_MS],
  );
  if (!claim.rowCount) return latest;   // another inference is in flight
  try {
    return await inferMood(userId);
  } catch (err) {
    const cause = err.cause?.code ? ` (${err.cause.code})` : '';
    console.warn('[mood] inference failed:', err.message + cause);
    return latest;
  } finally {
    // Compare-and-clear: only release if WE still hold the claim ($now), so a slow
    // holder (>INFER_CLAIM_MS) doesn't stomp a successor that already re-claimed.
    await pool.query('UPDATE users SET mood_inferring_at = NULL WHERE id = $1 AND mood_inferring_at = $2', [userId, now]).catch(() => {});
  }
}
