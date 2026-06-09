import { pool } from './db.js';
import { generateDnaNarrative } from './prompts/sonicDna.js';

const MS_DAY      = 86400000;
const WINDOW_DAYS = 30;
const MIN_EVENTS  = 10;

// Crude language-to-warmth mapping for the warmth axis when we don't have
// real valence data yet (the catalog doesn't return it).
const WARMTH_BY_LANGUAGE = {
  tamil: 0.7, hindi: 0.68, malayalam: 0.66, kannada: 0.62, telugu: 0.65,
  punjabi: 0.74, english: 0.55, instrumental: 0.35, unknown: 0.5,
};

function clamp01(x) { return Math.max(0, Math.min(1, x)); }

function rangeLabel(v) {
  if (v < 0.3) return 'low';
  if (v < 0.55) return 'medium';
  if (v < 0.78) return 'high';
  return 'very high';
}

function axisLabel(label, v) {
  if (label === 'pace')        return v < 0.4 ? 'patient'      : v < 0.7 ? 'steady'      : 'driven';
  if (label === 'warmth')      return v < 0.4 ? 'cool'         : v < 0.7 ? 'warm'        : 'glowing';
  if (label === 'texture')     return v < 0.4 ? 'dense'        : v < 0.7 ? 'spacious'    : 'airy';
  if (label === 'lyricism')    return v < 0.4 ? 'instrumental' : v < 0.7 ? 'word-led'    : 'narrative';
  if (label === 'familiarity') return v < 0.4 ? 'new-leaning'  : v < 0.7 ? 'half-new'    : 'returning';
  if (label === 'novelty')     return v < 0.4 ? 'familiar'     : v < 0.7 ? 'curious'     : 'exploring';
  return rangeLabel(v);
}

export async function getSonicDna(userId) {
  const now = Date.now();
  const windowStart = now - WINDOW_DAYS * MS_DAY;
  const priorStart  = windowStart - WINDOW_DAYS * MS_DAY;

  const { rows: events } = await pool.query(
    `SELECT e.id, e.track_id, e.ts, e.kind, e.mood, e.language, e.position_sec,
            t.title, t.artist, t.duration_sec
     FROM listening_events e
     LEFT JOIN tracks t ON t.id = e.track_id
     WHERE e.user_id = $1 AND e.ts >= $2`,
    [userId, priorStart],
  );

  const recent = events.filter(e => Number(e.ts) >= windowStart);
  const prior  = events.filter(e => Number(e.ts) <  windowStart);

  const plays = recent.filter(e => e.kind === 'play');
  if (plays.length < MIN_EVENTS) {
    return { available: false, eventsSeen: plays.length, threshold: MIN_EVENTS };
  }

  const skips = recent.filter(e => e.kind === 'skip').length;
  const ends  = recent.filter(e => e.kind === 'end');

  // language counts
  const languageCounts = {};
  const artistCounts   = {};
  const moodCounts     = {};
  const trackCounts    = new Map(); // track_id → { label: "title — artist", n }
  const seenTracks     = new Set();
  for (const e of plays) {
    const l = e.language ?? 'unknown';
    languageCounts[l] = (languageCounts[l] ?? 0) + 1;
    if (e.artist) artistCounts[e.artist] = (artistCounts[e.artist] ?? 0) + 1;
    if (e.mood)   moodCounts[e.mood]     = (moodCounts[e.mood] ?? 0) + 1;
    if (e.title) {
      const cur = trackCounts.get(e.track_id) ?? { label: `${e.title}${e.artist ? ` — ${e.artist}` : ''}`, n: 0 };
      cur.n++;
      trackCounts.set(e.track_id, cur);
    }
    seenTracks.add(e.track_id);
  }

  // axes
  // pace: average ratio of (position at end / duration). End events with deeper position → patient.
  let paceSum = 0, paceN = 0;
  for (const e of ends) {
    if (e.duration_sec && e.position_sec != null) {
      paceSum += clamp01(Number(e.position_sec) / Number(e.duration_sec));
      paceN++;
    }
  }
  const pace = paceN ? paceSum / paceN : 0.5;

  // warmth: weighted average of language-based warmth proxy
  const totalPlays = plays.length;
  let warmthSum = 0;
  for (const [lang, count] of Object.entries(languageCounts)) {
    warmthSum += (WARMTH_BY_LANGUAGE[lang] ?? 0.5) * (count / totalPlays);
  }
  const warmth = warmthSum;

  // texture: artist diversity = unique_artists / total_plays
  const texture = clamp01(Object.keys(artistCounts).length / Math.max(1, totalPlays));

  // lyricism: fraction of plays for tracks that have lyrics in the lyrics cache
  const trackIds = [...seenTracks];
  let lyricism = 0.5;
  if (trackIds.length) {
    const { rows: lyrRows } = await pool.query(
      `SELECT track_id FROM lyrics WHERE track_id = ANY($1::text[]) AND source != 'none'`,
      [trackIds],
    );
    const withLyrics = new Set(lyrRows.map(r => r.track_id));
    let lyrPlays = 0;
    for (const e of plays) if (withLyrics.has(e.track_id)) lyrPlays++;
    lyricism = clamp01(lyrPlays / totalPlays);
  }

  // familiarity: fraction of recent plays whose track also appeared in the prior window
  const priorTrackIds = new Set(prior.filter(e => e.kind === 'play').map(e => e.track_id));
  let repeats = 0;
  for (const e of plays) if (priorTrackIds.has(e.track_id)) repeats++;
  const familiarity = clamp01(repeats / totalPlays);
  const novelty     = clamp01(1 - familiarity);

  const axes = [
    { label: 'pace',        v: pace,        range: axisLabel('pace', pace)               },
    { label: 'warmth',      v: warmth,      range: axisLabel('warmth', warmth)           },
    { label: 'texture',     v: texture,     range: axisLabel('texture', texture)         },
    { label: 'lyricism',    v: lyricism,    range: axisLabel('lyricism', lyricism)       },
    { label: 'familiarity', v: familiarity, range: axisLabel('familiarity', familiarity) },
    { label: 'novelty',     v: novelty,     range: axisLabel('novelty', novelty)         },
  ];

  // thisMonth aggregates
  const totalSec = ends.reduce((acc, e) => acc + (Number(e.position_sec) || 0), 0);
  const hours    = +(totalSec / 3600).toFixed(1);
  const artists  = Object.keys(artistCounts).length;
  const newTracks = trackIds.filter(id => !priorTrackIds.has(id)).length;
  const returns   = repeats;

  // Sort + truncate aggregates for the Gemini narrative
  const topArtists = Object.entries(artistCounts).sort((a, b) => b[1] - a[1]).map(([k]) => k);
  const topTracks  = [...trackCounts.values()].sort((a, b) => b.n - a.n).slice(0, 8).map(t => t.label);
  const skipRate   = totalPlays > 0 ? skips / (totalPlays + skips) : 0;
  const repeatRate = familiarity;

  let signature = '—';
  let shift     = '—';
  try {
    const narrative = await generateDnaNarrative({
      axes, languageCounts, topArtists, topTracks, plays: totalPlays, skipRate, repeatRate,
    });
    signature = narrative.signature || signature;
    shift     = narrative.shift     || shift;
  } catch (err) {
    console.warn('[sonicDna] narrative failed:', err.message);
    signature = axes.slice(0, 3).map(a => a.range).join(' · ');
    shift     = `${totalPlays} plays · ${artists} artists`;
  }

  return {
    available: true,
    axes,
    topMoods: Object.entries(moodCounts).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([label, count]) => ({ label, count })),
    thisMonth: { hours, artists, newTracks, returns },
    signature,
    shift,
    eventsSeen: totalPlays,
  };
}
