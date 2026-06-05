import { pool } from './db.js';
import { generateJournalEntry, formatDateLabel } from './prompts/journal.js';

const MS_DAY = 86400000;

function isoDateLocal(ts) {
  const d = new Date(ts);
  // Local-time YYYY-MM-DD (so the user's "today" matches their wall clock)
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function aggregateDay(rows) {
  const plays = rows.filter(r => r.kind === 'play').length;
  const skips = rows.filter(r => r.kind === 'skip').length;
  const seen = new Set();
  const trackIds = [];
  const artistCounts = new Map();
  const languageCounts = new Map();
  const moodCounts = new Map();
  for (const r of rows) {
    if (!seen.has(r.track_id)) { seen.add(r.track_id); trackIds.push(r.track_id); }
    if (r.artist)   artistCounts.set(r.artist, (artistCounts.get(r.artist) ?? 0) + 1);
    if (r.language) languageCounts.set(r.language, (languageCounts.get(r.language) ?? 0) + 1);
    if (r.mood)     moodCounts.set(r.mood, (moodCounts.get(r.mood) ?? 0) + 1);
  }
  const topOf = (m) => [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  return {
    plays,
    skips,
    distinctTracks: trackIds.length,
    trackIds,
    topArtist:    topOf(artistCounts),
    topLanguage:  topOf(languageCounts),
    dominantMood: topOf(moodCounts),
  };
}

export async function getJournalEntries(userId, { days = 7 } = {}) {
  const since = Date.now() - days * MS_DAY;
  const { rows } = await pool.query(
    `SELECT e.id, e.track_id, e.ts, e.kind, e.mood, e.language,
            t.title, t.artist
     FROM listening_events e
     LEFT JOIN tracks t ON t.id = e.track_id
     WHERE e.user_id = $1 AND e.ts >= $2
     ORDER BY e.ts ASC`,
    [userId, since],
  );
  if (rows.length === 0) return { entries: [], totalEvents: 0 };

  // group by local YYYY-MM-DD
  const byDay = new Map();
  for (const r of rows) {
    const date = isoDateLocal(Number(r.ts));
    if (!byDay.has(date)) byDay.set(date, []);
    byDay.get(date).push(r);
  }

  // newest first; cap to `days`
  const sortedDays = [...byDay.keys()].sort().reverse().slice(0, days);
  const entries = [];

  for (const date of sortedDays) {
    const dayRows = byDay.get(date);
    const playRows = dayRows.filter(r => r.kind === 'play');
    if (playRows.length === 0) continue;

    const agg = aggregateDay(dayRows);
    const eventsSeen = dayRows.length;

    // cache lookup
    const cached = await pool.query(
      `SELECT payload, events_seen FROM journal_cache WHERE user_id = $1 AND date = $2`,
      [userId, date],
    );
    if (cached.rowCount && cached.rows[0].events_seen === eventsSeen) {
      entries.push({ date, label: formatDateLabel(date), tracks: agg.trackIds.slice(0, 6), ...cached.rows[0].payload });
      continue;
    }

    // generate
    const samples = dayRows.slice(0, 4).map(r => ({
      title:    r.title    ?? r.track_id,
      artist:   r.artist   ?? '',
      language: r.language,
      kind:     r.kind,
    }));
    let entry;
    try {
      entry = await generateJournalEntry({ isoDate: date, samples, ...agg });
    } catch (err) {
      console.warn('[journal] generate failed for', date, err.message);
      entry = {
        headline: `${agg.plays} plays.`,
        body: `mostly ${agg.topLanguage ?? 'mixed'}. top artist: ${agg.topArtist ?? '—'}.`,
        tag: agg.dominantMood ?? 'unlogged',
      };
    }

    await pool.query(
      `INSERT INTO journal_cache (user_id, date, payload, events_seen, fetched_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, date) DO UPDATE SET
         payload = EXCLUDED.payload,
         events_seen = EXCLUDED.events_seen,
         fetched_at = EXCLUDED.fetched_at`,
      [userId, date, JSON.stringify(entry), eventsSeen, Date.now()],
    );
    entries.push({ date, label: formatDateLabel(date), tracks: agg.trackIds.slice(0, 6), ...entry });
  }

  return { entries, totalEvents: rows.length };
}
