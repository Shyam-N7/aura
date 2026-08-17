// AURA radio from a seed track — the owned answer to YouTube mixes.
//
// Research verdict (2026-08, four-agent sweep): an RD mix is a recipe, not a
// record. YouTube generates it per request from the seed video plus the
// REQUESTER's identity, so the Data API — which has no user identity — can
// never return the mix the user's browser shows; the docs are silent on RD
// ids, and the unofficial paths (Innertube) are ToS-breaching, weekly-
// breaking, and blocked from datacenter IPs. So instead of chasing an
// unmatchable tail, we build our own: seed → the catalog's per-song station
// (related.js, which also feeds the track_similarity graph) → one bounded
// second hop for depth → the autoPlaylists edition chassis for a same-day
// cache. Stable, honest, and it improves with use instead of changing behind
// the user's back.
import { pool } from './db.js';
import { getTrackById } from './tracks.js';
import { getRelatedTracks, capPerArtist } from './related.js';
import { getSuppressedTrackIds, localDateKey, clampTzOffset } from './tasteScore.js';
import { loadEdition, storeEdition, hydrate, descriptor } from './autoPlaylists.js';
import { mapTrackRow } from './stats.js';

const SEED_MIX_SIZE = 40;
// Depth past the single station's ~20: stations for the top few first-hop
// tracks. Three keeps a cold build at ≤4 upstream calls; the similarity graph
// absorbs repeats.
const HOP2_STATIONS = 3;

/**
 * A served radio descriptor for the given seed. Same-day editions are cached
 * in mix_editions under `seed:<trackId>` — deliberately NOT registered in the
 * listed MIXES suite: seed radios are on-demand, not library-shelf residents.
 */
export async function getSeedMix(userId, seedId, { tzOffset = 0 } = {}) {
  const seed = await getTrackById(seedId);   // throws 404 for unknown ids

  const mixKey = `seed:${seedId}`;
  const tz = clampTzOffset(tzOffset);
  const editionKey = localDateKey(tz);
  const suppressed = await getSuppressedTrackIds(userId);

  const name = `radio from ${seed.title}`;
  const description = `songs in the orbit of ${seed.title} — grows smarter as you listen`;

  const cached = await loadEdition(userId, mixKey, editionKey);
  if (cached) {
    const tracks = await hydrate(cached.payload.tracks, suppressed);
    // A cache whose suppression-survivors are too thin to feel like radio is
    // rebuilt rather than served — hiding half your radio should not strand
    // the other half as the whole experience.
    if (tracks.length >= 8) {
      return descriptor(mixKey, name, description, tracks);
    }
  }

  // ── Build ──
  // Hop 1: the seed's own station (live — also warms track_similarity).
  const hop1 = await getRelatedTracks(seedId, { limit: 20 });

  // Hop 2: stations for the first few related tracks, for depth past ~20.
  const hop2Seeds = hop1.slice(0, HOP2_STATIONS);
  const hop2 = await Promise.all(
    hop2Seeds.map(t => getRelatedTracks(t.id, { limit: 20 }).catch(() => [])),
  );

  // The graph's memory of this seed — edges past sessions recorded that the
  // live station may not repeat today.
  const { rows: edges } = await pool.query(
    `SELECT related_track_id FROM track_similarity
      WHERE source_track_id = $1 ORDER BY rank ASC LIMIT 20`,
    [seedId],
  );

  // Assemble: seed first (a radio starts where you started it), hop-1 in the
  // station's own similarity order, hop-2 interleaved round-robin so no single
  // branch dominates a stretch, graph memories last. Suppressed (hidden/skip-
  // shelved) tracks never enter; hydrate re-applies suppression at serve time.
  const reason = new Map();
  const pool_ = [];
  const seen = new Set(suppressed);
  const take = (t, why) => {
    if (t?.id && !seen.has(t.id)) {
      seen.add(t.id);
      reason.set(t.id, why);
      pool_.push(t);
    }
  };
  take(seed, `radio from ${seed.title}`);
  for (const t of hop1) take(t, `close to ${seed.title}`);
  for (let i = 0; hop2.some(l => i < l.length); i++) {
    for (let s = 0; s < hop2.length; s++) {
      if (hop2[s][i]) take(hop2[s][i], `via ${hop2Seeds[s].title}`);
    }
  }
  const unseenEdges = edges.map(e => e.related_track_id).filter(id => !seen.has(id));
  if (unseenEdges.length) {
    const { rows } = await pool.query(
      `SELECT id, title, artist, album, language, duration_sec, stream_url, raw
         FROM tracks WHERE id = ANY($1)`,
      [unseenEdges],
    );
    for (const r of rows) take(mapTrackRow(r), 'from earlier radio');
  }

  // Artist diversity across the whole pool; the seed at position 0 survives
  // the cap because capPerArtist preserves order.
  const ordered = capPerArtist(pool_, 2).slice(0, SEED_MIX_SIZE);
  const payload = {
    tracks: ordered.map(t => ({ trackId: t.id, reason: reason.get(t.id) })),
  };
  await storeEdition(userId, mixKey, editionKey, payload);

  const tracks = await hydrate(payload.tracks, suppressed);
  return descriptor(mixKey, name, description, tracks);
}
