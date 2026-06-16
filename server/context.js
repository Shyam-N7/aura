// Listener context shared by LLM features (TalkAura, Bridges): recent listens,
// a sample of likes, and 30-day language affinity. Extracted from app.js so the
// SQL lives once and bridges.js can reuse it without importing the app.

import { pool } from './db.js';

// Track titles/artists are user-influenced free text that we splice into LLM
// prompts (TalkAura + Bridges). Flatten each to a single capped line so a crafted
// title can't inject newlines or run long to fake an instruction / break out of
// its `;`-joined slot. Defense in depth — the prompts also frame these as data.
// Control chars (incl. newlines/tabs, code point < 0x20, and DEL 0x7f) become a
// space — checked by code point so the source carries no literal control bytes.
function sanitizeForPrompt(s) {
  const flattened = Array.from(String(s ?? ''), (ch) => {
    const c = ch.codePointAt(0);
    return c < 0x20 || c === 0x7f ? ' ' : ch;
  }).join('');
  return flattened.replace(/\s+/g, ' ').trim().slice(0, 80);
}

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

  return {
    ...(clientContext ?? {}),
    recentListens: recentRows.map(r => sanitizeForPrompt(`${r.title} — ${r.artist}`)),
    likedSample:   likedRows.map(r => sanitizeForPrompt(`${r.title} — ${r.artist}`)),
    langAffinity,
  };
}
