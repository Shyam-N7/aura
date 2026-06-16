// Lyrics fetch-time analytics. One row per /api/lyrics request (see app.js), so
// we can see the true cost of a cold fetch (provider call + Gemini romanization),
// the cache-hit rate, and how each provider performs — and whether prefetching
// moved those numbers.

import { pool } from './db.js';

export async function recordLyricsMetric({ trackId, ms, cacheHit, source, synced, ok = true }) {
  await pool.query(
    `INSERT INTO lyrics_metrics (track_id, ts, ms, cache_hit, source, synced, ok)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [trackId, Date.now(), Math.round(ms), !!cacheHit, source ?? null, !!synced, !!ok],
  );
}

// Aggregate summary over the last `hours`. Cold (cache-miss) timings are the ones
// that matter for the >10s problem, so percentiles are computed over those.
export async function getLyricsStats({ hours = 24 } = {}) {
  const since = Date.now() - hours * 60 * 60 * 1000;

  const overall = await pool.query(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE cache_hit)::int AS cache_hits,
            count(*) FILTER (WHERE NOT ok)::int     AS errors
       FROM lyrics_metrics WHERE ts > $1`,
    [since],
  );
  const cold = await pool.query(
    `SELECT count(*)::int AS n,
            round(avg(ms))::int AS avg_ms,
            round(percentile_cont(0.5)  WITHIN GROUP (ORDER BY ms))::int AS p50_ms,
            round(percentile_cont(0.95) WITHIN GROUP (ORDER BY ms))::int AS p95_ms,
            max(ms)::int AS max_ms
       FROM lyrics_metrics WHERE ts > $1 AND NOT cache_hit AND ok`,
    [since],
  );
  const bySource = await pool.query(
    `SELECT source,
            count(*)::int AS n,
            round(avg(ms))::int AS avg_ms,
            round(percentile_cont(0.95) WITHIN GROUP (ORDER BY ms))::int AS p95_ms
       FROM lyrics_metrics WHERE ts > $1 AND NOT cache_hit AND ok
       GROUP BY source ORDER BY n DESC`,
    [since],
  );

  const o = overall.rows[0];
  return {
    window_hours: hours,
    total: o.total,
    cache_hits: o.cache_hits,
    cache_hit_rate: o.total ? Number((o.cache_hits / o.total).toFixed(3)) : null,
    errors: o.errors,
    cold_fetch: cold.rows[0],
    by_source: bySource.rows,
  };
}
