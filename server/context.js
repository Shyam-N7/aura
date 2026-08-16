// Listener context shared by LLM features (TalkAura, Bridges): recent listens,
// a sample of likes, and 30-day language affinity. Extracted from app.js so the
// SQL lives once and bridges.js can reuse it without importing the app.

import { pool } from './db.js';
import { sanitizeForPrompt } from './promptSafe.js';

// Raw 30-day language affinity rows: [{ language, plays, pct }], ordered by
// plays desc. pct is a rounded percentage of the window's total plays.
export async function getLangAffinity(userId) {
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const { rows: langRows } = await pool.query(`
    SELECT language, COUNT(*)::int AS plays
    FROM listening_events
    WHERE user_id = $1 AND kind = 'play' AND language IS NOT NULL AND ts > $2
    GROUP BY language
    ORDER BY plays DESC
    LIMIT 5
  `, [userId, cutoff]);
  const totalLangPlays = langRows.reduce((s, r) => s + r.plays, 0);
  return langRows.map(r => ({
    language: r.language,
    plays:    r.plays,
    pct:      totalLangPlays ? Math.round((r.plays / totalLangPlays) * 100) : 0,
  }));
}

/**
 * The languages this listener actually listens in, best first.
 *
 * 30-day play affinity, then any onboarding seed languages not already in it.
 * The two answer different questions and neither alone is enough: affinity is
 * empty for a new account, and a seed list is a stated preference that says
 * nothing about the last month.
 *
 * NOT run through bridges.js `cleanLangs`, and that is the point. That helper
 * whitelists down to the five languages the bridges server threads on, which
 * would silently discard exactly the values a cross-language disambiguation
 * needs to tell apart — a Gujarati or Bhojpuri row would come back as "no
 * preference" rather than as itself.
 *
 * Lowercased here because `tracks.language` is stored raw, straight from the
 * provider, and is never normalised on write.
 *
 * Returns [] for a listener we know nothing about, and every caller must read
 * that as "no opinion, change nothing" rather than as "prefers nothing" — a new
 * account's first import is the worst possible place to start guessing.
 */
export async function getUserLanguages(userId) {
  if (!userId) {
    return [];
  }
  const [affinity, seed] = await Promise.all([
    getLangAffinity(userId).catch(() => []),
    pool
      .query(`SELECT seed_languages FROM users WHERE id = $1`, [userId])
      .then(r => r.rows[0]?.seed_languages ?? [])
      .catch(() => []),
  ]);

  const out = [];
  const push = value => {
    const l = String(value ?? '').trim().toLowerCase();
    if (l && !out.includes(l)) {
      out.push(l);
    }
  };
  affinity.forEach(r => push(r.language));
  (Array.isArray(seed) ? seed : []).forEach(push);
  return out;
}

export async function buildTalkContext(userId, clientContext) {
  const { rows: recentRows } = await pool.query(`
    SELECT t.title, t.artist, MAX(e.ts) AS last_ts
    FROM listening_events e
    JOIN tracks t ON t.id = e.track_id
    WHERE e.user_id = $1 AND e.kind = 'play'
    GROUP BY t.title, t.artist
    ORDER BY last_ts DESC
    LIMIT 8
  `, [userId]);
  const { rows: likedRows } = await pool.query(`
    SELECT t.title, t.artist
    FROM liked_tracks lt
    JOIN tracks t ON t.id = lt.track_id
    WHERE lt.user_id = $1
    ORDER BY lt.liked_at DESC
    LIMIT 10
  `, [userId]);
  const affinity = await getLangAffinity(userId);
  const langAffinity = affinity.map(r => `${r.language} ${r.pct}%`);

  // Pick ONLY the known client key (mood) rather than spreading the untrusted
  // client context wholesale — everything else the prompt uses is server-derived
  // below. (security: #5)
  return {
    mood: clientContext?.mood,
    recentListens: recentRows.map(r => sanitizeForPrompt(`${r.title} — ${r.artist}`)),
    likedSample:   likedRows.map(r => sanitizeForPrompt(`${r.title} — ${r.artist}`)),
    langAffinity,
  };
}
