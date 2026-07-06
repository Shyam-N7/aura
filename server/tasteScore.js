// The taste-score engine behind the "made for you" mixes — pure SQL builders and
// date helpers, no upstream I/O. Every rule here must stay explainable in one
// plain sentence (that sentence ships in the UI), so no blended magic numbers
// beyond the documented weights.
//
// Scoring model (frecency): each event contributes weight × exp(-ln2 · age/halfLife).
// NOTE the per-event weights compose — every listen logs a `play` row, a natural
// finish ADDS an `end` row and an abandon ADDS a `skip` row (useListeningRecorder),
// so the EFFECTIVE per-listen scores are: completed = +1.3, bare start = +0.3,
// skipped = -0.5. Don't "fix" the weights without re-deriving those sums.
// A like adds a flat +1.0 (no decay — an explicit contract, not behavior).
//
// Mode-aware profile: family/kids-mode plays never shape the taste profile (the
// scores below), but they DO still count as "heard" for discovery's novelty rule —
// that check deliberately lives in discoveryMix and ignores mode.

import { pool } from './db.js';

export const WEIGHTS = { end: 1.0, play: 0.3, skip: -0.8 };
export const HALF_LIFE_CURRENT_DAYS = 28;   // "what you're into lately"
export const HALF_LIFE_ALLTIME_DAYS = 180;  // slow-moving all-time taste
export const PROFILE_MODES_EXCLUDED = ['family', 'kids'];

// Skip-shelving — the one-sentence rule: "you skipped this at least twice in the
// last 90 days, never finished it, and haven't liked it." Self-healing: a single
// completion or a like un-shelves. Deliberately conservative because skips are
// binary here (no position captured — a 95%-listened bail looks like a 5s one).
export const SHELF_WINDOW_DAYS = 90;
export const SHELF_MIN_SKIPS = 2;

// Dayparts — two segments only; finer splits hit sparsity on one user's history.
export const MORNING_HOURS = [5, 10];         // 05:00–10:59 local, inclusive
export const NIGHT_FROM = 20, NIGHT_TO = 3;   // 20:00–03:59 local, wraps midnight

const DAY_MS = 24 * 60 * 60 * 1000;

// Decayed, completion-weighted, like-boosted track scores for one user, joined
// against `tracks` so rows come back playable. Options:
//   halfLifeDays  — decay half-life (required)
//   windowDays    — only consider events newer than N days (cheapness + focus)
//   minPlays      — HAVING floor on play events per track
//   dormantDays   — only tracks whose LAST play is older than N days ("bring it back")
//   daypart       — 'morning' | 'night', with tzOffsetMin (JS getTimezoneOffset convention)
//   language      — restrict to tracks of one catalog language (discovery seeds)
//   limit         — LIMIT
export async function getScoredTracks(userId, {
  halfLifeDays,
  windowDays = null,
  minPlays = 1,
  dormantDays = null,
  daypart = null,
  tzOffsetMin = 0,
  language = null,
  limit = 50,
} = {}) {
  const now = Date.now();
  const params = [userId, WEIGHTS.end, WEIGHTS.play, WEIGHTS.skip, now,
    halfLifeDays * DAY_MS, PROFILE_MODES_EXCLUDED];
  let where = `e.user_id = $1 AND e.kind IN ('play','end','skip')
      AND NOT (COALESCE(e.mode, 'everyday') = ANY($7))`;
  if (windowDays != null) {
    params.push(now - windowDays * DAY_MS);
    where += ` AND e.ts > $${params.length}`;
  }
  if (daypart === 'morning' || daypart === 'night') {
    // User-local hour from the ms epoch: local = utc - offsetMin (JS convention,
    // IST = -330). BIGINT arithmetic throughout; ts is always > |offset| so the
    // modulo stays positive.
    params.push(clampTzOffset(tzOffsetMin) * 60000);
    const hour = `(((e.ts - $${params.length}) % 86400000) / 3600000)`;
    where += daypart === 'morning'
      ? ` AND ${hour} BETWEEN ${MORNING_HOURS[0]} AND ${MORNING_HOURS[1]}`
      : ` AND (${hour} >= ${NIGHT_FROM} OR ${hour} <= ${NIGHT_TO})`;
  }

  params.push(minPlays);
  let having = `COUNT(*) FILTER (WHERE e.kind = 'play') >= $${params.length}`;

  let outer = '';
  if (dormantDays != null) {
    params.push(now - dormantDays * DAY_MS);
    outer += ` AND ev.last_play_ts < $${params.length}`;
  }
  if (language) {
    params.push(language);
    outer += ` AND LOWER(t.language) = LOWER($${params.length})`;
  }
  params.push(limit);

  const { rows } = await pool.query(
    `WITH ev AS (
       SELECT e.track_id,
              -- ::float8 casts matter twice: the ELSE 0 literal would otherwise
              -- type the weight params as integer, and bigint/bigint division
              -- would TRUNCATE the decay exponent to whole half-lives.
              SUM((CASE e.kind WHEN 'end' THEN $2::float8 WHEN 'play' THEN $3::float8 WHEN 'skip' THEN $4::float8 ELSE 0 END)
                  * EXP(-LN(2) * ($5 - e.ts) / $6::float8)) AS ev_score,
              MAX(e.ts) FILTER (WHERE e.kind = 'play')      AS last_play_ts,
              COUNT(*)  FILTER (WHERE e.kind = 'play')::int AS plays,
              COUNT(*)  FILTER (WHERE e.kind = 'end')::int  AS completions
       FROM listening_events e
       WHERE ${where}
       GROUP BY e.track_id
       HAVING ${having}
     )
     SELECT t.id, t.title, t.artist, t.album, t.language, t.duration_sec, t.stream_url, t.raw,
            ev.ev_score + (CASE WHEN lt.track_id IS NOT NULL THEN 1.0 ELSE 0 END) AS score,
            ev.last_play_ts, ev.plays, ev.completions
     FROM ev
     JOIN tracks t ON t.id = ev.track_id
     LEFT JOIN liked_tracks lt ON lt.user_id = $1 AND lt.track_id = ev.track_id
     WHERE (ev.ev_score > 0 OR lt.track_id IS NOT NULL)${outer}
     ORDER BY score DESC, ev.last_play_ts DESC
     LIMIT $${params.length}`,
    params,
  );
  return rows;
}

// Tracks that must never be picked FOR the user: explicitly hidden ("don't show
// this again" — hiddenTracks.js owns the CRUD) plus implicitly skip-shelved.
// One UNION so every consumer (mixes, auto-radio demotion) shares the same rule.
export async function getSuppressedTrackIds(userId) {
  const { rows } = await pool.query(
    `SELECT track_id FROM hidden_tracks WHERE user_id = $1
     UNION
     SELECT e.track_id
     FROM listening_events e
     WHERE e.user_id = $1 AND e.ts > $2
     GROUP BY e.track_id
     HAVING COUNT(*) FILTER (WHERE e.kind = 'skip') >= $3
        AND COUNT(*) FILTER (WHERE e.kind = 'end') = 0
        AND NOT EXISTS (SELECT 1 FROM liked_tracks lt
                        WHERE lt.user_id = $1 AND lt.track_id = e.track_id)`,
    [userId, Date.now() - SHELF_WINDOW_DAYS * DAY_MS, SHELF_MIN_SKIPS],
  );
  return new Set(rows.map(r => r.track_id));
}

// ---- edition keys ------------------------------------------------------------
// Editions are keyed by the USER'S local date (client sends its tz offset; the
// music-clock endpoint set this "client owns local time" precedent). Offsets use
// the JS Date#getTimezoneOffset convention: minutes to ADD to local to get UTC
// (IST = -330). Clamped to real-world bounds; missing/garbage → UTC.

export function clampTzOffset(min) {
  const n = Number(min);
  if (!Number.isFinite(n)) return 0;
  return Math.max(-840, Math.min(840, Math.trunc(n)));
}

function localMs(tzOffsetMin, now) {
  return now - clampTzOffset(tzOffsetMin) * 60000;
}

// Local calendar date, 'YYYY-MM-DD' — the daily edition key.
export function localDateKey(tzOffsetMin, now = Date.now()) {
  return new Date(localMs(tzOffsetMin, now)).toISOString().slice(0, 10);
}

// Date of the most recent given weekday (0=Sun … 6=Sat), inclusive of today —
// the weekly edition key ("fresh every friday" = key advances each Friday).
export function lastWeekdayKey(tzOffsetMin, weekday, now = Date.now()) {
  const ms = localMs(tzOffsetMin, now);
  const back = (new Date(ms).getUTCDay() - weekday + 7) % 7;
  return new Date(ms - back * DAY_MS).toISOString().slice(0, 10);
}

export const lastFridayKey = (tz, now) => lastWeekdayKey(tz, 5, now);
export const lastMondayKey = (tz, now) => lastWeekdayKey(tz, 1, now);
