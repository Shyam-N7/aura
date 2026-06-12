// Mood bridges v2: given a from-mood and a to-mood, plan an ordered run of
// tracks that walks the listener between them. L1 asks Gemini for a per-step
// query plan grounded in the listener's context, then searches the catalog per
// rung. L2 (any L1 failure) is the v1 half/half curated-query algorithm. L3:
// when even that yields nothing usable, the route surfaces a 502.
// getBridgeSuggestion picks tonight's from/to from the mood snapshot.

import { searchSongs, dedupeSongs } from './catalog.js';
import { generateBridgePlan, sanitizePlan, STAGE_LABELS } from './prompts/bridge.js';
import { timeOfDayFromHour } from './prompts/greeting.js';
import { buildTalkContext, getLangAffinity } from './context.js';
import { inferIfStale } from './mood.js';
import { cacheTracks } from './tracks.js';
import { pool } from './db.js';

// Plain-emotion buckets. The left group is "where you are" (current feeling),
// the right is "where you want to be" — the configurator shows different words
// on each side, all mapping to a search query here.
const MOOD_QUERIES = {
  // where you are
  sad:       'sad emotional songs',
  stressed:  'calm soothing music',
  restless:  'soft acoustic indie',
  tired:     'mellow chill songs',
  lonely:    'melancholy indie songs',
  // where you want to be
  happy:     'happy feel-good hits',
  calm:      'relaxing chill music',
  focused:   'instrumental focus music',
  energized: 'high energy upbeat hits',
  social:    'party hits',
};

export const MOODS = Object.keys(MOOD_QUERIES);

// Language-scoped variants: the catalog's text search is strict — wordy
// queries like "tamil happy feel-good hits" return ZERO rows, while short
// ones ("tamil happy songs") return full pages. When a side-query must be
// scoped to a language, use `${lang} ${SIMPLE}` instead of the wordy form.
const MOOD_QUERIES_SIMPLE = {
  sad:       'sad songs',
  stressed:  'calm songs',
  restless:  'acoustic songs',
  tired:     'chill songs',
  lonely:    'sad melody',
  happy:     'happy songs',
  calm:      'relaxing songs',
  focused:   'instrumental',
  energized: 'upbeat songs',
  social:    'dance songs',
};

function sideQuery(mood, lang) {
  return lang ? `${lang} ${MOOD_QUERIES_SIMPLE[mood]}` : MOOD_QUERIES[mood];
}

const ALL_LANGS = ['tamil', 'english', 'hindi', 'malayalam', 'kannada'];

// Lowercase, whitelist to the languages the catalog actually serves, max 2.
function cleanLangs(list) {
  return (Array.isArray(list) ? list : [])
    .map(l => String(l ?? '').trim().toLowerCase())
    .filter(l => ALL_LANGS.includes(l))
    .slice(0, 2);
}

// The listener's language mix: 30d affinity top-2, else onboarding seed
// languages, else []. Every lookup is best-effort.
async function resolveLangs(userId) {
  try {
    const affinity = await getLangAffinity(userId);
    const langs = cleanLangs(affinity.map(r => r.language));
    if (langs.length) return langs;
  } catch { /* fall through */ }
  try {
    const { rows } = await pool.query('SELECT seed_languages FROM users WHERE id = $1', [userId]);
    const langs = cleanLangs(rows[0]?.seed_languages);
    if (langs.length) return langs;
  } catch { /* fall through */ }
  return [];
}

// ── Tonight's suggested journey ─────────────────────────────────────

// Destination ladder, calm → social. Drift nudges the landing one notch.
const LADDER = ['calm', 'focused', 'happy', 'energized', 'social'];

// Mood snapshot vocabulary → default bridge endpoints.
const BASE = {
  restless: { from: 'restless', to: 'focused' },
  focused:  { from: 'stressed', to: 'calm' },
  calm:     { from: 'tired',    to: 'calm' },
  upbeat:   { from: 'tired',    to: 'energized' },
  warm:     { from: 'lonely',   to: 'happy' },
  social:   { from: 'restless', to: 'social' },
};

const EVENING_SLOTS = ['evening', 'late-evening'];
const LATE_SLOTS    = ['late-evening', 'late-night'];

const SLOT_PHRASE = {
  'late-night':     'tonight',
  morning:          'this morning',
  afternoon:        'this afternoon',
  'late-afternoon': 'this afternoon',
  evening:          'tonight',
  'late-evening':   'tonight',
};

const DEST_LINE = {
  calm:      'this bridge lets you down gently',
  focused:   'this bridge settles you into focus',
  happy:     'this bridge walks you somewhere brighter',
  energized: 'this bridge builds you back up',
  social:    'this bridge points you at the night',
};

// Pure mapping from a mood snapshot + hour to a suggested from/to pair, or
// null when the read is too weak to suggest anything.
export function suggestJourney({ mood, confidence = 0, drift = 'steady', hour = 20 } = {}) {
  if (!mood || !BASE[mood] || Number(confidence) < 0.45) return null;
  const slot = timeOfDayFromHour(hour);
  const isEvening = EVENING_SLOTS.includes(slot);
  const { from } = BASE[mood];
  let { to } = BASE[mood];

  if (mood === 'upbeat' && isEvening) to = 'social';
  if (to === 'social' && !isEvening)  to = 'energized';

  let idx = LADDER.indexOf(to);
  if (drift === 'cooling') idx = Math.max(idx - 1, 0);
  if (drift === 'warming') idx = Math.min(idx + 1, LADDER.length - 1);
  // Late at night, never point the bridge anywhere louder than focus.
  if (LATE_SLOTS.includes(slot)) idx = Math.min(idx, 1);

  return { from, to: LADDER[idx] };
}

export async function getBridgeSuggestion(userId, { hour = new Date().getHours() } = {}) {
  const snapshot = await inferIfStale(userId).catch(() => null);
  const affinity = await getLangAffinity(userId).catch(() => []);
  let langs = cleanLangs(affinity.map(r => r.language));
  if (!langs.length) langs = await resolveLangs(userId);

  const journey = snapshot ? suggestJourney({ ...snapshot, hour }) : null;
  if (!journey) {
    return {
      from: 'sad', to: 'happy', steps: 5, mood: null, confidence: 0,
      reason: "no strong read on you yet — here's the classic lift. play a few songs and this gets sharper.",
      langs,
    };
  }

  const slotPhrase = SLOT_PHRASE[timeOfDayFromHour(hour)] ?? 'today';
  const why = snapshot.reason ? String(snapshot.reason).toLowerCase().replace(/\.+$/, '') : '';
  const reason = [
    `reading you as ${snapshot.mood} ${slotPhrase}`,
    why ? ` — ${why}` : '',
    `. ${DEST_LINE[journey.to]}.`,
  ].join('');

  return {
    from: journey.from, to: journey.to, steps: 5,
    mood: snapshot.mood, confidence: snapshot.confidence, reason, langs,
  };
}

// ── Bridge track assembly ───────────────────────────────────────────

function dateSeed() {
  return new Date().toISOString().slice(0, 10);
}

let cachedSeed = null;
const MAX_CACHE = 500;
const cache = new Map(); // key: `${userId}|${from}|${to}|${steps}|${langs}` → { narrative, tracks }
const inflight = new Map(); // same key → pending build promise

function cacheForToday() {
  const seed = dateSeed();
  if (seed !== cachedSeed) {
    cache.clear();
    cachedSeed = seed;
  }
  return cache;
}

function cacheSet(c, key, value) {
  if (c.size >= MAX_CACHE) c.delete(c.keys().next().value);
  c.set(key, value);
}

function pickUnused(tracks, used) {
  return (tracks ?? []).find(t => t.streamUrl && !used.has(t.id)) ?? null;
}

// The catalog's `lang` option is a POST-filter on text-search results, so a
// generic query ("sad emotional songs") scoped to tamil can starve — the
// provider's first page simply contains no tamil rows. Biasing the query text
// with the language word fixes the pool; the post-filter then guarantees it.
function langScoped(query, lang) {
  if (!lang) return { query, limit: 12 };
  const q = query.toLowerCase().includes(lang) ? query : `${lang} ${query}`;
  return { query: q, limit: 24 };
}

function usable(settled) {
  return settled.status === 'fulfilled' ? settled.value.filter(t => t.streamUrl) : [];
}

async function planWithTimeout(args, ms = 12_000) {
  let timer;
  try {
    return await Promise.race([
      generateBridgePlan(args),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('bridge plan timed out')), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

// L1: Gemini plans one query per rung; we search each, then assemble in order,
// deduping globally and borrowing neighbor spares when a rung starves.
async function assemblePlanned({ userId, from, to, steps, resolved }) {
  const context = await buildTalkContext(userId)
    .catch(() => ({ recentListens: [], likedSample: [], langAffinity: [] }));
  const snapshot = await inferIfStale(userId).catch(() => null);
  const slot = timeOfDayFromHour(new Date().getHours());

  const allowedLangs = resolved.length ? resolved : ALL_LANGS;
  // Decorate the allowed list with affinity percentages where we know them
  // ('tamil 62%'), so the model can roughly match the listener's mix.
  const pctByLang = new Map(
    (context.langAffinity ?? []).map(s => [String(s).split(' ')[0].toLowerCase(), s]),
  );
  const plan = await planWithTimeout({
    from, to, steps,
    allowedLangs: allowedLangs.map(l => pctByLang.get(l) ?? l),
    slot,
    moodReason: snapshot?.reason ?? undefined,
    context,
  });
  const sanitized = sanitizePlan(plan, { steps, allowedLangs });

  const defaults = STAGE_LABELS[steps] ?? STAGE_LABELS[5];
  const half = Math.ceil(steps / 2);
  const constrained = resolved.length > 0;
  // Null rungs (model gave no usable query) fall back to the curated v1
  // queries: from-side for the first half, to-side for the rest. The
  // listener's languages are a HARD guarantee: a rung the model left
  // unscoped (or off-list, which sanitize nulls) gets pinned round-robin
  // onto the allowed picks — never searched unfiltered.
  const rungs = sanitized.steps.map((s, i) => {
    const language = s?.language ?? (constrained ? resolved[i % resolved.length] : undefined);
    return {
      query:    s?.query ?? sideQuery(i < half ? from : to, language),
      language,
      label:    s?.label ?? defaults[i] ?? 'turning',
    };
  });

  const settled = await Promise.allSettled(
    rungs.map(r => {
      const { query, limit } = langScoped(r.query, r.language);
      return searchSongs(query, { limit, lang: r.language });
    }),
  );
  const buckets = settled.map(usable);

  const used = new Set();
  const tracks = [];
  for (let i = 0; i < steps; i++) {
    let track = pickUnused(buckets[i], used);
    // Starving rung: neighbor spares (prev, then next)…
    if (!track && i > 0)         track = pickUnused(buckets[i - 1], used);
    if (!track && i < steps - 1) track = pickUnused(buckets[i + 1], used);
    // …then the curated side-query: the rung's language first, then the other
    // allowed pick. Dropping the language filter entirely is only legal when
    // the listener didn't constrain languages.
    if (!track) {
      const sideMood = i < half ? from : to;
      const tryLangs = [...new Set(constrained
        ? [rungs[i].language, ...resolved.filter(l => l !== rungs[i].language)]
        : [rungs[i].language, undefined])];
      for (const lang of tryLangs) {
        track = await searchSongs(sideQuery(sideMood, lang), { limit: lang ? 24 : 12, lang })
          .then(r => pickUnused(r, used)).catch(() => null);
        if (track) break;
      }
    }
    if (!track) continue; // drop the rung
    used.add(track.id);
    tracks.push({ ...track, stepLabel: rungs[i].label });
  }

  // Belt and braces on the guarantee: an explicitly off-language track can
  // never ship. Missing language metadata is tolerated — every constrained
  // search above was lang-scoped, so blanks are catalog gaps, not leaks.
  const kept = constrained
    ? tracks.filter(t => t.language == null || resolved.includes(String(t.language).toLowerCase()))
    : tracks;
  if (kept.length < Math.ceil(steps / 2)) {
    throw new Error('bridge plan starved');
  }
  const narrative = sanitized.narrative || `from ${from} to ${to}, one step at a time.`;
  return { narrative, tracks: kept };
}

// L2: the v1 half/half curated-query algorithm, scoped to the listener's top
// language when we know it. L3: both searches empty → 502.
async function assembleFallback({ from, to, steps, resolved }) {
  const fromCount = Math.ceil(steps / 2);
  const toCount   = steps - fromCount;
  const overshoot = 3; // fetch extra to survive dedup + missing streamUrl
  const lang = resolved[0]; // undefined when the mix is unknown

  const [fromRes, toRes] = await Promise.allSettled([
    searchSongs(sideQuery(from, lang), { limit: lang ? 24 : fromCount + overshoot, lang }),
    searchSongs(sideQuery(to,   lang), { limit: lang ? 24 : toCount   + overshoot, lang }),
  ]);
  const fromTracks = usable(fromRes);
  const toTracks   = usable(toRes);

  if (fromTracks.length === 0 && toTracks.length === 0) {
    const err = new Error('no playable tracks for this bridge');
    err.statusCode = 502;
    throw err;
  }

  // Dedupe across both buckets so a song shared by both moods doesn't repeat.
  const labels = STAGE_LABELS[steps] ?? STAGE_LABELS[5];
  const tracks = dedupeSongs([
    ...fromTracks.slice(0, fromCount),
    ...toTracks.slice(0,   toCount),
  ]).slice(0, steps).map((t, i) => ({ ...t, stepLabel: labels[i] ?? 'turning' }));

  return { narrative: `from ${from} to ${to}, one step at a time.`, tracks };
}

async function buildBridge({ userId, from, to, steps, resolved, key, c }) {
  let result;
  try {
    result = await assemblePlanned({ userId, from, to, steps, resolved });
  } catch {
    result = await assembleFallback({ from, to, steps, resolved });
  }
  await cacheTracks(result.tracks).catch(() => {});
  cacheSet(c, key, result);
  return result;
}

export async function getBridgeTracks({ userId, from, to, steps = 5, langs = [] } = {}) {
  if (!MOOD_QUERIES[from] || !MOOD_QUERIES[to]) {
    const err = new Error('unknown mood');
    err.statusCode = 400;
    throw err;
  }
  const n = Math.min(Math.max(Number(steps) || 5, 4), 8);
  const requested = cleanLangs(langs);
  const resolved = requested.length ? requested : await resolveLangs(userId);

  const key = `${userId}|${from}|${to}|${n}|${[...resolved].sort().join(',')}`;
  const c = cacheForToday();
  const cached = c.get(key);
  if (cached) return cached;

  const pending = inflight.get(key);
  if (pending) return pending;

  const build = buildBridge({ userId, from, to, steps: n, resolved, key, c });
  inflight.set(key, build);
  try {
    return await build;
  } finally {
    inflight.delete(key);
  }
}
