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
const TOTAL = 12;                 // headroom: the client family-filters, then shows 8
const POOL_LIMIT = 40;            // scored candidates fetched before cap/suppression
const ROTATION_DEPTH = 24;        // rotating slots draw from ranks 4..24 of the pool

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
  // Deterministic per-day rotation; the salt (user-initiated reroll) is the only
  // non-calendar input, so reloads within a day are stable by construction.
  const seed = `${userId}|${editionKey}${salt ? `|${salt}` : ''}`;
  const rotating = pickDaily(rotationPool, TOTAL - anchors.length, seed)
    .map(r => toPick(r, false));

  let tracks = [...anchors, ...rotating];

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

  return { tracks, editionKey, cadence: 'rotates daily' };
}
