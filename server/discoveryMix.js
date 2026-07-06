// "new to you" — the discovery mix, and the only mix with upstream I/O. The
// promise it makes is enforceable on our own data: ZERO tracks the user has ever
// played (any event kind, ANY mode — a family-mode play still counts as "heard"),
// nothing they've liked, playlisted, hidden or shelved, and no cover/alt-credit of
// a song they know. Composition is language-proportional to their real 30-day
// listening shares — the honest answer to "language roulette".
//
// Candidates come from two owned sources, seeded by the user's own top tracks:
//   - track_similarity — the seed→related graph auto-radio has been writing
//     (this module is its first reader)
//   - getRelatedTracks — the live per-song station (env-gated; may be off)
// If both run thin the mix is simply omitted — never padded from featured pools.

import { pool } from './db.js';
import { getLangAffinity } from './context.js';
import { getRelatedTracks, normalizeTitle, capPerArtist } from './related.js';
import { getScoredTracks, HALF_LIFE_CURRENT_DAYS, PROFILE_MODES_EXCLUDED } from './tasteScore.js';
import { effectiveExplicitOff } from './modes.js';
import { cacheTracks } from './tracks.js';

export const DISCOVERY_SIZE = 30;
const MIN_LANG_PCT = 10;     // languages under 10% of listening don't get a quota
const MAX_LANGS = 3;
const MIN_QUOTA = 3;         // a kept language never gets fewer than 3 slots
const SEEDS_PER_LANG = 3;
const MAX_SEEDS = 8;         // wall-clock guard: ≤8 station calls per generation
const RELATED_TIMEOUT_MS = 6000;
const SIM_PER_SEED = 20;

// Minimum-data gate (the Wrapped model — explicit, with progress): the mix needs
// a real taste signal before it can honestly claim "seeded from your listening".
export const GATE = { tracks: 30, artists: 5, windowDays: 90 };

export async function getDiscoveryGate(userId) {
  const { rows } = await pool.query(
    `SELECT COUNT(DISTINCT e.track_id)::int AS tracks, COUNT(DISTINCT t.artist)::int AS artists
     FROM listening_events e
     JOIN tracks t ON t.id = e.track_id
     WHERE e.user_id = $1 AND e.kind = 'play' AND e.ts > $2
       AND NOT (COALESCE(e.mode, 'everyday') = ANY($3))`,
    [userId, Date.now() - GATE.windowDays * 86400000, PROFILE_MODES_EXCLUDED],
  );
  const have = rows[0]?.tracks ?? 0;
  const artists = rows[0]?.artists ?? 0;
  return { ok: have >= GATE.tracks && artists >= GATE.artists, have, need: GATE.tracks };
}

// Display-clean a seed title for receipts: drop the "(From "Movie")" credit but
// keep the casing (normalizeTitle lowercases — that's for matching, not showing).
function cleanSeedTitle(s) {
  return (s ?? '').replace(/\(from\s+[^)]*\)/giu, ' ').replace(/\s+/g, ' ').trim();
}

const raced = (p, ms, fallback) =>
  Promise.race([p, new Promise(res => setTimeout(() => res(fallback), ms))]).catch(() => fallback);

function rowToCandidate(r) {
  const raw = r.raw ?? {};
  return {
    id: r.id, title: r.title, artist: r.artist, album: r.album, language: r.language,
    durationSec: r.duration_sec, streamUrl: r.stream_url, imageUrl: raw.imageUrl ?? null,
    explicit: raw.explicit === true,
  };
}

// Fisher-Yates, then a greedy repair pass so no artist repeats within 3 slots —
// only matters when the per-artist cap was relaxed to 2, but cheap either way.
function shuffleWithSpacing(list) {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  const key = c => (c.t.artist || '').toLowerCase().trim();
  for (let i = 0; i < out.length; i++) {
    const recent = out.slice(Math.max(0, i - 3), i).map(key);
    if (!recent.includes(key(out[i]))) continue;
    for (let j = i + 1; j < out.length; j++) {
      if (!recent.includes(key(out[j]))) { [out[i], out[j]] = [out[j], out[i]]; break; }
    }
  }
  return out;
}

// Build one edition. Returns { tracks: [{trackId, reason}], meta } — the caller
// (autoPlaylists) owns storage, gating and MIN_SET policy. Returns null when the
// candidate pool is too thin to be honest about.
export async function buildDiscoveryMix(userId, { tzOffset = 0, size = DISCOVERY_SIZE } = {}) {
  // 1. Language shares → quotas proportional to real listening.
  const affinity = await getLangAffinity(userId);
  let kept = affinity.filter(a => a.pct >= MIN_LANG_PCT && a.language).slice(0, MAX_LANGS);
  if (!kept.length && affinity.length) kept = affinity.slice(0, 1);

  // 2. Seeds: the user's current top tracks per kept language.
  const seedLists = await Promise.all(
    (kept.length ? kept : [{ language: null }]).map(k =>
      getScoredTracks(userId, {
        halfLifeDays: HALF_LIFE_CURRENT_DAYS, windowDays: 60, minPlays: 2,
        language: k.language ?? null, limit: SEEDS_PER_LANG,
      }).catch(() => [])),
  );
  let seeds = [];
  const langOf = new Map();
  seedLists.forEach((rows, i) => {
    const lang = kept[i]?.language ?? null;
    for (const r of rows) {
      seeds.push({ id: r.id, title: r.title, language: (lang ?? r.language ?? '').toLowerCase() });
      langOf.set(r.id, (lang ?? r.language ?? '').toLowerCase());
    }
  });
  seeds = seeds.slice(0, MAX_SEEDS);
  if (!seeds.length) return null;

  // Languages that produced seeds share the quota; renormalize over their pcts.
  const seededLangs = [...new Set(seeds.map(s => s.language).filter(Boolean))];
  const pctOf = Object.fromEntries(kept.map(k => [String(k.language).toLowerCase(), k.pct]));
  const totalPct = seededLangs.reduce((s, l) => s + (pctOf[l] ?? 0), 0) || 1;
  const quotas = new Map(seededLangs.map(l =>
    [l, Math.max(MIN_QUOTA, Math.round(size * (pctOf[l] ?? 0) / totalPct))]));

  // 3. What the user already knows / must never be picked — fetched in parallel.
  const [playedRes, titlesRes, likedRes, plRes, userRes] = await Promise.all([
    pool.query(`SELECT DISTINCT track_id FROM listening_events WHERE user_id = $1`, [userId]),
    pool.query(
      `SELECT DISTINCT t.title FROM listening_events e JOIN tracks t ON t.id = e.track_id
       WHERE e.user_id = $1`, [userId]),
    pool.query(`SELECT track_id FROM liked_tracks WHERE user_id = $1`, [userId]),
    pool.query(
      `SELECT DISTINCT pt.track_id FROM playlist_tracks pt
       JOIN playlists p ON p.id = pt.playlist_id WHERE p.user_id = $1`, [userId]),
    pool.query(`SELECT active_mode, modes_state FROM users WHERE id = $1`, [userId]),
  ]);
  const knownIds = new Set([
    ...playedRes.rows.map(r => r.track_id),
    ...likedRes.rows.map(r => r.track_id),
    ...plRes.rows.map(r => r.track_id),
  ]);
  const knownTitles = new Set(titlesRes.rows.map(r => normalizeTitle(r.title)).filter(Boolean));
  const explicitOff = effectiveExplicitOff(
    userRes.rows[0]?.modes_state ?? {}, userRes.rows[0]?.active_mode ?? 'everyday');

  // 4. Candidates: similarity graph (one batched read) + live stations, per seed.
  const seedIds = seeds.map(s => s.id);
  const { rows: simRows } = await pool.query(
    `SELECT source_track_id, related_track_id
     FROM track_similarity WHERE source_track_id = ANY($1)
     ORDER BY observed_at DESC, rank ASC LIMIT $2`,
    [seedIds, SIM_PER_SEED * seedIds.length],
  ).catch(() => ({ rows: [] }));
  const simIdsBySeed = new Map();
  for (const r of simRows) {
    const list = simIdsBySeed.get(r.source_track_id) ?? [];
    if (list.length < SIM_PER_SEED) { list.push(r.related_track_id); simIdsBySeed.set(r.source_track_id, list); }
  }
  const allSimIds = [...new Set([...simIdsBySeed.values()].flat())];
  const simTracks = new Map();
  if (allSimIds.length) {
    const { rows } = await pool.query(
      `SELECT id, title, artist, album, language, duration_sec, stream_url, raw
       FROM tracks WHERE id = ANY($1)`, [allSimIds]);
    for (const r of rows) simTracks.set(r.id, rowToCandidate(r));
  }
  const liveLists = await Promise.all(seeds.map(s =>
    raced(getRelatedTracks(s.id, { lang: s.language || undefined, limit: 20 }), RELATED_TIMEOUT_MS, [])));

  // 5. Filter into per-language, per-seed buckets. `seenTitles` also dedupes
  //    within the candidate set itself (covers collapse to one recording).
  const seenTitles = new Set(knownTitles);
  const buckets = new Map();   // lang → Map(seedId → [{t, seed, prov}])
  const admit = (t, seed, prov) => {
    if (!t?.id || !t.streamUrl) return;
    if (knownIds.has(t.id)) return;                       // the novelty guarantee
    const titleKey = normalizeTitle(t.title);
    if (!titleKey || seenTitles.has(titleKey)) return;    // knows the song by any credit
    if (explicitOff && t.explicit === true) return;
    const lang = (t.language || seed.language || '').toLowerCase();
    if (!buckets.has(lang)) buckets.set(lang, new Map());
    const perSeed = buckets.get(lang);
    if (!perSeed.has(seed.id)) perSeed.set(seed.id, []);
    perSeed.get(seed.id).push({ t, seed, prov });
    seenTitles.add(titleKey);
  };
  seeds.forEach((seed, i) => {
    for (const t of liveLists[i]) admit(t, seed, 'station');
    for (const id of simIdsBySeed.get(seed.id) ?? []) {
      const t = simTracks.get(id);
      if (t) admit(t, seed, 'graph');
    }
  });

  // 6. Assemble: fill each language quota round-robin across its seeds so no
  //    single seed dominates; then top up from whatever's left, largest bucket
  //    first (an honest approximation when one language runs dry).
  const takeRoundRobin = (perSeed, n) => {
    const lists = [...perSeed.values()];
    const out = [];
    for (let round = 0; out.length < n; round++) {
      let took = false;
      for (const list of lists) {
        if (round < list.length && out.length < n) { out.push(list[round]); took = true; }
      }
      if (!took) break;
    }
    return out;
  };
  let picked = [];
  const leftovers = [];
  for (const [lang, perSeed] of buckets) {
    const want = quotas.get(lang) ?? 0;
    const got = takeRoundRobin(perSeed, want || 0);
    picked.push(...got);
    const flat = [...perSeed.values()].flat();
    leftovers.push(...flat.filter(c => !got.includes(c)));
  }
  if (picked.length < size) picked.push(...leftovers.slice(0, size - picked.length));

  // 7. Diversity: one per artist, relaxing to two only when the pool is thin.
  const capped1 = capPerArtist(picked.map(c => ({ ...c, artist: c.t.artist })), 1);
  const capped = capped1.length >= size ? capped1
    : capPerArtist(picked.map(c => ({ ...c, artist: c.t.artist })), 2);
  const finalPicks = shuffleWithSpacing(capped.slice(0, size));
  if (!finalPicks.length) return null;

  // Live candidates may not be persisted yet (getRelatedTracks caches fire-and-
  // forget) — the edition hydrates via JOIN tracks, so persist the chosen ones.
  await cacheTracks(finalPicks.filter(c => c.prov === 'station').map(c => c.t));

  return {
    tracks: finalPicks.map(c => ({
      trackId: c.t.id,
      reason: c.prov === 'graph'
        ? `near ${cleanSeedTitle(c.seed.title)} in your listening graph`
        : `because you kept playing ${cleanSeedTitle(c.seed.title)}`,
    })),
    meta: {
      tz: tzOffset,
      langShares: Object.fromEntries([...quotas.entries()]),
      seedIds,
    },
  };
}
