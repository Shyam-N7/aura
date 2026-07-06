// "Made for you" mixes — the suite orchestrator. Each mix's eligibility rule fits
// in one plain sentence (that sentence ships in the UI), and every set is computed
// from the user's OWN listening_events via tasteScore.js — no cross-user data, no
// LLM. Editions are dated snapshots cached in mix_editions (journal_cache pattern,
// never deleted — past editions are the archive):
//   on repeat      daily      top decayed 28d scores, ≥2 plays
//   bring it back  weekly Mon high all-time (180d-decay) score, dormant ≥60 days
//   new to you     weekly Fri never played, language-proportional (discoveryMix.js)
//   morning/night  weekly Mon decayed scores restricted to that local daypart
// Suppressed tracks (skip-shelved + explicitly hidden) are excluded at generation
// AND at serve time, so hiding a track takes effect immediately.

import { pool } from './db.js';
import { mapTrackRow } from './stats.js';
import { capPerArtist } from './related.js';
import {
  getScoredTracks, getSuppressedTrackIds, clampTzOffset,
  localDateKey, lastFridayKey, lastMondayKey,
  HALF_LIFE_CURRENT_DAYS, HALF_LIFE_ALLTIME_DAYS,
} from './tasteScore.js';
import { buildDiscoveryMix, getDiscoveryGate, GATE } from './discoveryMix.js';

const MIN_SET = 5;        // hide sets thinner than this
export const RULE_LINE = "made from your listening — skips count. family & kids plays don't.";

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTHS_FULL = ['january', 'february', 'march', 'april', 'may', 'june', 'july',
  'august', 'september', 'october', 'november', 'december'];

function editionLabel(editionKey) {
  const d = new Date(`${editionKey}T00:00:00Z`);
  return `edition · ${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

// ---- familiar-mix generators ---------------------------------------------------
// Each returns { tracks: [{trackId, reason}], meta, description? } or null when
// the data can't honestly support the mix. Receipts are template strings — the
// numbers come straight from the score query.

async function genOnRepeat(userId, tz, suppressed) {
  const rows = await getScoredTracks(userId, {
    halfLifeDays: HALF_LIFE_CURRENT_DAYS, windowDays: 60, minPlays: 2, limit: 60,
  });
  const kept = capPerArtist(rows.filter(r => !suppressed.has(r.id)), 2).slice(0, 30);
  if (kept.length < MIN_SET) return null;
  return {
    tracks: kept.map(r => ({
      trackId: r.id,
      reason: r.completions >= 2 ? `you finished this ${r.completions}× lately`
        : r.completions === 1 ? 'you finished this lately'
        : `${r.plays} plays this month`,
    })),
    meta: { tz },
  };
}

async function genBringItBack(userId, tz, suppressed) {
  const rows = await getScoredTracks(userId, {
    halfLifeDays: HALF_LIFE_ALLTIME_DAYS, dormantDays: 60, minPlays: 3, limit: 50,
  });
  const kept = capPerArtist(rows.filter(r => !suppressed.has(r.id)), 2).slice(0, 25);
  if (kept.length < MIN_SET) return null;
  const monthOf = r => {
    const d = new Date(Number(r.last_play_ts));   // BIGINT arrives as a string
    return Number.isFinite(d.getTime()) ? d.getUTCMonth() : null;
  };
  const counts = new Map();
  for (const r of kept) {
    const m = monthOf(r);
    if (m != null) counts.set(m, (counts.get(m) ?? 0) + 1);
  }
  const [topMonth, topCount] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0] ?? [null, 0];
  return {
    tracks: kept.map(r => {
      const m = monthOf(r);
      return {
        trackId: r.id,
        reason: m == null ? `${r.plays} plays, none in a while`
          : `big for you in ${MONTHS_FULL[m]} — ${r.plays} plays, none since`,
      };
    }),
    meta: { tz },
    description: topMonth != null && topCount >= kept.length * 0.6
      ? `your ${MONTHS_FULL[topMonth]} songs, mostly`
      : 'you used to love these — time for a revisit',
  };
}

// Two dayparts only — finer splits go sparse on one listener's history. The gate
// (≥40 daypart plays across qualifying tracks) keeps a mix from claiming a habit
// the data doesn't show; under it, the mix is simply omitted.
async function genDaypart(userId, tz, suppressed, daypart) {
  const rows = await getScoredTracks(userId, {
    halfLifeDays: HALF_LIFE_CURRENT_DAYS, windowDays: 60, minPlays: 2,
    daypart, tzOffsetMin: tz, limit: 40,
  });
  const kept = capPerArtist(rows.filter(r => !suppressed.has(r.id)), 2).slice(0, 20);
  const daypartPlays = kept.reduce((s, r) => s + r.plays, 0);
  if (kept.length < MIN_SET || daypartPlays < 40) return null;
  return {
    tracks: kept.map(r => ({
      trackId: r.id,
      reason: `a ${daypart} regular — ${r.plays} ${daypart} plays`,
    })),
    meta: { tz },
  };
}

// ---- the suite -----------------------------------------------------------------

const MIXES = {
  'on-repeat': {
    name: 'on repeat', keyFn: localDateKey, gen: genOnRepeat,
    description: 'what you keep coming back to — updated daily',
  },
  'new-to-you': {
    name: 'new to you', keyFn: lastFridayKey, gen: null,   // discoveryMix.js
    description: "fresh every friday — nothing you've played before",
  },
  'bring-it-back': {
    name: 'bring it back', keyFn: lastMondayKey, gen: genBringItBack,
    description: 'you used to love these — time for a revisit',
  },
  morning: {
    name: 'your morning songs', keyFn: lastMondayKey,
    gen: (u, tz, sup) => genDaypart(u, tz, sup, 'morning'),
    description: 'what you reach for in the morning',
  },
  night: {
    name: 'your night songs', keyFn: lastMondayKey,
    gen: (u, tz, sup) => genDaypart(u, tz, sup, 'night'),
    description: 'what you reach for after dark',
  },
};
const MIX_ORDER = Object.keys(MIXES);

async function loadEdition(userId, mixKey, editionKey) {
  const { rows } = await pool.query(
    `SELECT payload, edition_key FROM mix_editions
     WHERE user_id = $1 AND mix_key = $2 AND edition_key = $3`,
    [userId, mixKey, editionKey],
  );
  return rows[0] ?? null;
}

async function loadLatestEdition(userId, mixKey) {
  const { rows } = await pool.query(
    `SELECT payload, edition_key FROM mix_editions
     WHERE user_id = $1 AND mix_key = $2
     ORDER BY generated_at DESC LIMIT 1`,
    [userId, mixKey],
  );
  return rows[0] ?? null;
}

async function storeEdition(userId, mixKey, editionKey, payload) {
  await pool.query(
    `INSERT INTO mix_editions (user_id, mix_key, edition_key, payload, generated_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id, mix_key, edition_key)
     DO UPDATE SET payload = EXCLUDED.payload, generated_at = EXCLUDED.generated_at`,
    [userId, mixKey, editionKey, JSON.stringify(payload), Date.now()],
  );
}

// Resolve one mix to a served edition: cache hit → that edition; miss → generate
// inline for the cheap SQL mixes; for discovery, serve the previous edition and
// let the nightly cron catch the fresh one up (first-ever generates inline).
async function resolveMix(userId, mixKey, tz, suppressed) {
  const def = MIXES[mixKey];
  const editionKey = def.keyFn(tz);
  const hit = await loadEdition(userId, mixKey, editionKey);
  if (hit) return { payload: hit.payload, editionKey, refreshing: false };

  if (mixKey !== 'new-to-you') {
    const payload = await def.gen(userId, tz, suppressed);
    if (!payload) return null;
    await storeEdition(userId, mixKey, editionKey, payload);
    return { payload, editionKey, refreshing: false };
  }

  const gate = await getDiscoveryGate(userId);
  if (!gate.ok) return { gate };
  const prev = await loadLatestEdition(userId, mixKey);
  if (prev) {
    // Serve last Friday's edition honestly (its date is displayed); the cron
    // pre-warms the new one. Fire-and-forget here would race the lambda freeze.
    return { payload: prev.payload, editionKey: prev.edition_key, refreshing: true };
  }
  const payload = await buildDiscoveryMix(userId, { tzOffset: tz });
  if (!payload || payload.tracks.length < MIN_SET) return null;
  await storeEdition(userId, mixKey, editionKey, payload);
  return { payload, editionKey, refreshing: false };
}

// Hydrate stored {trackId, reason} rows through the tracks table so metadata and
// stream URLs stay as fresh as every other shelf. Order and reasons are the
// edition's; suppressed/hidden tracks drop out immediately, vanished tracks skip.
async function hydrate(payloadTracks, suppressed) {
  const ids = payloadTracks.map(t => t.trackId).filter(id => !suppressed.has(id));
  if (!ids.length) return [];
  const { rows } = await pool.query(
    `SELECT id, title, artist, album, language, duration_sec, stream_url, raw
     FROM tracks WHERE id = ANY($1)`, [ids],
  );
  const byId = new Map(rows.map(r => [r.id, mapTrackRow(r)]));
  const out = [];
  for (const t of payloadTracks) {
    const row = byId.get(t.trackId);
    if (row) out.push({ ...row, reason: t.reason });
  }
  return out;
}

function descriptor(mixKey, name, description, tracks, extra = {}) {
  return {
    id: `auto:${mixKey}`,
    kind: 'auto',
    mixKey,
    name,
    description,
    tracks,
    trackCount: tracks.length,
    coverImageUrl: tracks.find(t => t.imageUrl)?.imageUrl ?? null,
    ruleLine: RULE_LINE,
    ...extra,
  };
}

// The suite. Old clients keep working: same route, same envelope, `tracks` still
// full playable rows — the edition/receipt fields are additive.
export async function getAutoPlaylists(userId, { tzOffset } = {}) {
  const tz = clampTzOffset(tzOffset);
  const suppressed = await getSuppressedTrackIds(userId);
  const resolved = await Promise.all(
    MIX_ORDER.map(mixKey =>
      resolveMix(userId, mixKey, tz, suppressed)
        .catch(err => {
          console.warn(`[mixes] ${mixKey} failed:`, err?.message ?? err);
          return null;
        })),
  );

  const sets = [];
  for (let i = 0; i < MIX_ORDER.length; i++) {
    const mixKey = MIX_ORDER[i];
    const def = MIXES[mixKey];
    const r = resolved[i];
    if (!r) continue;
    if (r.gate) {
      sets.push(descriptor(mixKey, def.name, def.description, [], {
        kind: 'auto-gate',
        gate: { need: r.gate.need, have: r.gate.have, line: `unlocks after ~${GATE.tracks} songs — you're at ${r.gate.have}` },
      }));
      continue;
    }
    const tracks = await hydrate(r.payload.tracks, suppressed);
    if (tracks.length < MIN_SET) continue;
    sets.push(descriptor(mixKey, def.name, r.payload.description ?? def.description, tracks, {
      editionKey: r.editionKey,
      editionLabel: editionLabel(r.editionKey),
      refreshing: r.refreshing,
    }));
  }
  return sets;
}

// Nightly pre-warm, piggybacked on the existing cron (02:00 UTC ≈ 07:30 IST — the
// daily edition exists before the morning open). Only users who listened this
// week; only editions that don't exist yet; soft time budget so the lyrics queue
// behind us always gets its turn.
export async function refreshDueMixes({ budgetMs = 40000 } = {}) {
  const deadline = Date.now() + budgetMs;
  const { rows: users } = await pool.query(
    `SELECT DISTINCT user_id FROM listening_events WHERE ts > $1`,
    [Date.now() - 7 * 86400000],
  );
  let generated = 0;
  for (const { user_id: userId } of users) {
    if (Date.now() > deadline) break;
    let suppressed;
    try {
      // Editions key on the user's local date; reuse the tz their client last sent.
      const { rows } = await pool.query(
        `SELECT payload->'meta'->>'tz' AS tz FROM mix_editions
         WHERE user_id = $1 ORDER BY generated_at DESC LIMIT 1`, [userId]);
      const tz = clampTzOffset(rows[0]?.tz);
      suppressed = await getSuppressedTrackIds(userId);
      for (const mixKey of MIX_ORDER) {
        if (Date.now() > deadline) break;
        const def = MIXES[mixKey];
        const editionKey = def.keyFn(tz);
        if (await loadEdition(userId, mixKey, editionKey)) continue;
        let payload = null;
        if (mixKey === 'new-to-you') {
          const gate = await getDiscoveryGate(userId);
          if (gate.ok) payload = await buildDiscoveryMix(userId, { tzOffset: tz });
        } else {
          payload = await def.gen(userId, tz, suppressed);
        }
        if (payload && payload.tracks.length >= MIN_SET) {
          await storeEdition(userId, mixKey, editionKey, payload);
          generated++;
        }
      }
    } catch (err) {
      console.warn('[mixes] cron refresh failed for user:', err?.message ?? err);
    }
  }
  return { users: users.length, generated };
}
