// Mood inference: read the listener's recent listening events, classify their
// current mood via Gemini, cache as a snapshot. Other features (TalkAura,
// Bridges, Why-this) read getCurrentMood / inferIfStale to stay in sync.

import { pool } from './db.js';
import { generateMoodInference } from './prompts/moodInfer.js';

const STALE_EVENTS  = 30;            // re-infer once 30 new plays have arrived
const STALE_AGE_MS  = 30 * 60 * 1000; // or after 30 minutes
const WINDOW_SIZE   = 30;             // events fed to the LLM

async function totalPlayCount(userId) {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM listening_events WHERE user_id = $1 AND kind = 'play'`,
    [userId],
  );
  return rows[0]?.n ?? 0;
}

export async function getCurrentMood(userId) {
  const { rows } = await pool.query(`
    SELECT id, ts, mood, confidence, drift, events_seen
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
  const { rows: events } = await pool.query(`
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
    INSERT INTO mood_snapshots (user_id, ts, mood, confidence, drift, events_seen)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING id, ts, mood, confidence, drift, events_seen
  `, [userId, Date.now(), result.mood, result.confidence, result.drift, playsTotal]);
  return rows[0];
}

export async function inferIfStale(userId) {
  const latest = await getCurrentMood(userId);
  if (!(await isStale(userId, latest))) return latest;
  try {
    return await inferMood(userId);
  } catch (err) {
    const cause = err.cause?.code ? ` (${err.cause.code})` : '';
    console.warn('[mood] inference failed:', err.message + cause);
    return latest;
  }
}
