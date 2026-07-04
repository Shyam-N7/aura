import { swapBitrate, hasBitrateToken } from './audioQuality.js';

// Per-track loudness for volume leveling — the YouTube/Amazon model: measure a
// track once, store its dB figure, and let the player attenuate hot tracks via
// el.volume. Attenuate-only by design: boosting quiet tracks needs a Web Audio
// limiter, and tapping the element into Web Audio kills screen-off playback on
// phones (see lib/platform isTapUnsafe) — so quiet tracks simply play at the
// user's raw volume. Measurement decodes the smallest CDN variant (48 kbps ≈
// 1.4 MB for a 4-min track) through an OfflineAudioContext used purely as a
// low-rate decode target, takes the overall RMS, and caches the dB per track id.

const KEY = 'aura.loudness.v1';
// ≈ the old AGC target (RMS 0.16 ≈ -16 dBFS); hot masters land well above this
// so they get pulled down toward it. Tune by ear against real catalog tracks.
export const LEVEL_TARGET_DB = -16;
const MIN_MEASURABLE_DB = -60;    // below this = silence/broken decode — don't store
const MAX_ENTRIES = 1500;         // ~60 KB of localStorage; evict oldest-written
const MAX_MEASURE_SEC = 12 * 60;  // don't decode marathon programs on phones
const DECODE_RATE = 12000;        // decode-target sample rate (memory, not accuracy)

function readAll() {
  try {
    const map = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    return map && typeof map === 'object' ? map : {};
  } catch { return {}; }
}
function writeAll(map) {
  try { localStorage.setItem(KEY, JSON.stringify(map)); } catch { /* full/disabled — track just stays unmeasured */ }
}

// Measured loudness for a track, or null when it hasn't been measured yet.
export function getTrackDb(trackId) {
  if (!trackId) return null;
  const db = readAll()[trackId]?.db;
  return Number.isFinite(db) ? db : null;
}

// Store a measurement, evicting the oldest-written entries past the cap.
export function storeTrackDb(trackId, db) {
  const map = readAll();
  map[trackId] = { db, at: Date.now() };
  const ids = Object.keys(map);
  if (ids.length > MAX_ENTRIES) {
    ids.sort((a, b) => (map[a]?.at ?? 0) - (map[b]?.at ?? 0));
    for (const id of ids.slice(0, ids.length - MAX_ENTRIES)) delete map[id];
  }
  writeAll(map);
}

// Attenuate-only leveling gain: unmeasured (null) plays at unity; a hot track
// comes down toward the target; a quiet one is NEVER boosted (gain caps at 1).
export function levelGainForDb(trackDb) {
  if (!Number.isFinite(trackDb)) return 1;
  return Math.min(1, Math.pow(10, (LEVEL_TARGET_DB - trackDb) / 20));
}

// Candidate urls for measurement, cheapest first. Only token'd catalog urls are
// measurable — downloading an arbitrary url of unknown size isn't worth it.
export function measurementUrls(streamUrl) {
  if (!hasBitrateToken(streamUrl)) return [];
  return [swapBitrate(streamUrl, 48), swapBitrate(streamUrl, 96)];
}

// Overall RMS of decoded PCM channels → dBFS; null for effective silence so a
// junk figure is never stored.
export function dbFromChannels(channels) {
  let sum = 0, n = 0;
  for (const ch of channels) {
    for (let i = 0; i < ch.length; i++) sum += ch[i] * ch[i];
    n += ch.length;
  }
  if (!n) return null;
  const db = 20 * Math.log10(Math.sqrt(sum / n) || Number.MIN_VALUE);
  return db > MIN_MEASURABLE_DB ? db : null;
}

// One measurement at a time (phones), deduped per track: a second request
// QUEUES behind the in-flight one rather than being dropped, so the current
// track's and the upcoming track's measurements never cancel each other. Never
// throws — every failure path resolves null and the track simply plays
// unleveled until a later attempt succeeds. Skipped while the page is hidden:
// background fetch+decode gets throttled, and a later foreground load retries.
const inflight = new Map();
let queue = Promise.resolve();

export function measureTrack(track) {
  const id = track?.id;
  if (!id || !track?.streamUrl) return Promise.resolve(null);
  const cached = getTrackDb(id);
  if (cached != null) return Promise.resolve(cached);
  if (typeof document !== 'undefined' && document.hidden) return Promise.resolve(null);
  if ((track.durationSec ?? 0) > MAX_MEASURE_SEC) return Promise.resolve(null);
  if (inflight.has(id)) return inflight.get(id);
  const p = queue.then(() => doMeasure(track));
  inflight.set(id, p);
  queue = p.then(() => inflight.delete(id));   // doMeasure never rejects
  return p;
}

async function doMeasure(track) {
  // Re-check at RUN time — this may have sat queued behind another measurement.
  const cached = getTrackDb(track.id);
  if (cached != null) return cached;
  if (typeof document !== 'undefined' && document.hidden) return null;
  const Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!Ctx) return null;
  for (const candidate of measurementUrls(track.streamUrl)) {
    try {
      const res = await fetch(candidate);   // CDN sends ACAO:* (the element already streams it cross-origin)
      if (!res.ok) continue;                // e.g. a track with no 48k variant — try the next tier
      const bytes = await res.arrayBuffer();
      const buf = await new Ctx(1, 1, DECODE_RATE).decodeAudioData(bytes);
      const channels = [];
      for (let c = 0; c < buf.numberOfChannels; c++) channels.push(buf.getChannelData(c));
      const db = dbFromChannels(channels);
      if (db == null) return null;
      storeTrackDb(track.id, db);
      return db;
    } catch { /* fetch/decode failed — try the next candidate */ }
  }
  return null;
}
