// Quick picks — the home ring, served honestly. Ranks the user's own listening
// with the same frecency engine as the mixes (likes boost, skips drag, hidden and
// skip-shelved tracks never appear), anchors the top 3 so the surface stays
// recognizable, and rotates the rest once per USER-LOCAL day via a deterministic
// seed — a reload mid-day returns the same ring, tomorrow's ring differs. An
// explicit `salt` (the "shuffle all" action) rerolls the rotating slots only.
//
// Sparse histories top up from recently-played; if the data still can't fill a
// ring, we return what's real and the client keeps its featured-pool fallback —
// never fabricated picks.

import { pool } from './db.js';
import { mapTrackRow, getRecentlyPlayed } from './stats.js';
import { capPerArtist } from './related.js';
import { pickDaily } from './featured.js';
import { getImpressionSignals, applyPenalty } from './impressions.js';
import {
  getScoredTracks, getSuppressedTrackIds, clampTzOffset, localDateKey,
  HALF_LIFE_CURRENT_DAYS,
} from './tasteScore.js';

export const ANCHOR_COUNT = 3;    // slots that only move when taste itself moves
export const SURFACE = 'quick-picks';   // impression key for this surface
const SHOWN = 8;                  // what the client actually shows (after family-filter)
const TOTAL = 12;                 // headroom: the client family-filters, then shows 8
const POOL_LIMIT = 40;            // scored candidates fetched before cap/suppression
const ROTATION_DEPTH = 24;        // rotating slots draw from ranks 4..24 of the pool
const EXPLORE_CANDIDATES = 20;    // graph neighbours considered for the "something new" slot

// Local-hour daypart bucket — folded into the rotation seed so the rotating
// slots re-shuffle at daypart boundaries (~4×/day: morning ≠ evening), while the
// anchors still move only once a day. The client mirrors these exact boundaries
// to label the shelf ("your evening picks").
export function daypartOf(tz, now = Date.now()) {
  const localMs = now - clampTzOffset(tz) * 60000;
  const h = Math.floor(((localMs % 86400000) + 86400000) % 86400000 / 3600000);
  if (h >= 5 && h < 12) return 'morning';
  if (h >= 12 && h < 17) return 'afternoon';
  if (h >= 17 && h < 21) return 'evening';
  return 'night';
}

// One "something new" pick: a track from the user's OWN similarity graph they've
// never played / liked / playlisted / hidden, preferring the ones we've shown
// least (so it self-corrects via impressions). Owned data only — no upstream —
// and best-effort: a thin graph just returns null and the ring skips the slot.
async function getExplorationPick(userId, seedIds, editionKey) {
  if (!seedIds.length) return null;
  try {
    const { rows } = await pool.query(
      `SELECT t.id, t.title, t.artist, t.album, t.language, t.duration_sec, t.stream_url, t.raw,
              COALESCE((SELECT SUM(im.count) FROM impressions im
                        WHERE im.user_id = $1 AND im.track_id = t.id AND im.surface = $3), 0) AS shown
       FROM track_similarity ts
       JOIN tracks t ON t.id = ts.related_track_id
       WHERE ts.source_track_id = ANY($2)
         AND t.stream_url IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM listening_events e WHERE e.user_id = $1 AND e.track_id = t.id)
         AND NOT EXISTS (SELECT 1 FROM liked_tracks   lt WHERE lt.user_id = $1 AND lt.track_id = t.id)
         AND NOT EXISTS (SELECT 1 FROM hidden_tracks  h  WHERE h.user_id  = $1 AND h.track_id  = t.id)
         AND NOT EXISTS (SELECT 1 FROM playlist_tracks pt JOIN playlists p ON p.id = pt.playlist_id
                         WHERE p.user_id = $1 AND pt.track_id = t.id)
       GROUP BY t.id
       ORDER BY shown ASC, MIN(ts.rank) ASC
       LIMIT $4`,
      [userId, seedIds, SURFACE, EXPLORE_CANDIDATES],
    );
    if (!rows.length) return null;
    const pick = pickDaily(rows, 1, `${userId}|${editionKey}|explore`)[0];
    return { ...mapTrackRow(pick), explicit: pick.raw?.explicit === true, reason: 'something new', anchor: false, exploration: true };
  } catch (err) {
    console.warn('[quickPicks] exploration pick failed:', err?.message ?? err);
    return null;
  }
}

// One plain sentence per pick, straight from the data that ranked it.
function reasonFor(r) {
  if (r.completions >= 2) return `you finished this ${r.completions}× lately`;
  if (r.liked) return 'you liked this';
  if (r.completions === 1) return 'you finished this lately';
  if (r.plays >= 2) return `${r.plays} plays this month`;
  return 'you played this recently';
}

// The explicit flag rides along so the client's family-mode filter (dropExplicit)
// can see it — mapTrackRow alone drops `raw`.
function toPick(r, anchor) {
  return { ...mapTrackRow(r), explicit: r.raw?.explicit === true, reason: reasonFor(r), anchor };
}

export async function getQuickPicks(userId, { tzOffset, salt } = {}) {
  const tz = clampTzOffset(tzOffset);
  const editionKey = localDateKey(tz);
  const suppressed = await getSuppressedTrackIds(userId);

  const scored = await getScoredTracks(userId, {
    halfLifeDays: HALF_LIFE_CURRENT_DAYS, windowDays: 30, minPlays: 1, limit: POOL_LIMIT,
  });
  const pool = capPerArtist(scored.filter(r => !suppressed.has(r.id)), 2);

  const anchorRows = pool.slice(0, ANCHOR_COUNT);   // raw top-3, exempt from demotion
  const rest = pool.slice(ANCHOR_COUNT);

  // Demote picks we've shown you repeatedly but you never played: each unplayed
  // shown-day multiplies the score down (so it sinks through the window), and a
  // cooled-down pick is held out entirely. This is the learned signal — anchors,
  // which you demonstrably play, are never touched.
  const signals = await getImpressionSignals(userId, SURFACE, rest.map(r => r.id));
  const rotationPool = rest
    .filter(r => !signals.get(r.id)?.cooledDown)
    .map(r => ({ r, adj: applyPenalty(r.score, signals.get(r.id)?.unplayedShownDays) }))
    .sort((a, b) => b.adj - a.adj)
    .map(x => x.r)
    .slice(0, ROTATION_DEPTH - ANCHOR_COUNT);

  const anchors = anchorRows.map(r => toPick(r, true));

  // One exploration pick from the similarity graph (seeded by the top tracks).
  const explore = await getExplorationPick(userId, pool.slice(0, SHOWN).map(r => r.id), editionKey);

  // Deterministic rotation, re-seeded per daypart (so evening ≠ morning) and by
  // the salt (the user's "shuffle all"). Reloads within a daypart are stable.
  const daypart = daypartOf(tz);
  const seed = `${userId}|${editionKey}|${daypart}${salt ? `|${salt}` : ''}`;
  const rotating = pickDaily(rotationPool, TOTAL - anchors.length - (explore ? 1 : 0), seed)
    .map(r => toPick(r, false));

  // Place the exploration pick as the 8th shown slot — after the anchors and the
  // first few rotating picks — so it lands inside the visible ring (not the
  // family-filter headroom) without ever displacing an anchor.
  let tracks;
  if (explore) {
    const before = SHOWN - ANCHOR_COUNT - 1;
    tracks = [...anchors, ...rotating.slice(0, before), explore, ...rotating.slice(before)];
  } else {
    tracks = [...anchors, ...rotating];
  }

  // Sparse history: top up from recently-played (still the user's own listening).
  if (tracks.length < TOTAL) {
    const have = new Set(tracks.map(t => t.id));
    const recent = await getRecentlyPlayed(userId, { limit: TOTAL });
    for (const t of recent) {
      if (tracks.length >= TOTAL) break;
      if (have.has(t.id) || suppressed.has(t.id)) continue;
      have.add(t.id);
      tracks.push({ ...t, reason: 'you played this recently', anchor: false });
    }
  }

  return { tracks, editionKey, cadence: 'rotates daily', daypart };
}
