// Lyrics fetcher. Tries the synced-lyrics provider (LRC format) then falls back
// to the catalog's plain-text lyrics endpoint. When the text is in a non-Latin
// script we also produce a romanized (English-script) version via Gemini, so
// callers can toggle between the original and the singable Latin version.
//
// Returns one of:
//   { available: true,  synced: true,  lines: [{t, line, line_en?}, ...], has_english, source }
//   { available: true,  synced: false, plain, plain_en?,                  has_english, source }
//   { available: false, synced: false }

import { needsRomanization, romanizeLines, romanizePlain } from './prompts/romanize.js';
// Endpoints, user-agents, and the lyrics timeout come from the environment
// (see config.js / .env.example). The synced-lyrics provider wants an
// identifiable UA — a generic browser UA sometimes 429s there — which is why
// the two sources use different agents.
import {
  CATALOG_API_BASE, CATALOG_USER_AGENT, CATALOG_CTX, CATALOG_API_VERSION, CATALOG_M_LYRICS,
  LYRICS_API_BASE, LYRICS_USER_AGENT, LYRICS_TIMEOUT_MS,
} from './config.js';

function fetchWithTimeout(url, { headers, ms = LYRICS_TIMEOUT_MS } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  return fetch(url, { headers, signal: ctl.signal })
    .finally(() => clearTimeout(timer));
}

// "[mm:ss.xx]line text"  →  { t: seconds, line: text }
function parseLRC(lrc) {
  if (!lrc) return [];
  const out = [];
  const lines = lrc.split(/\r?\n/);
  const re = /^\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\](.*)$/;
  for (const raw of lines) {
    const m = re.exec(raw);
    if (!m) continue;
    const minutes = Number(m[1]);
    const seconds = Number(m[2]);
    const fracStr = m[3] ?? '0';
    const frac    = Number(fracStr.padEnd(3, '0')) / 1000;
    const t = minutes * 60 + seconds + frac;
    const line = (m[4] ?? '').trim();
    out.push({ t, line });
  }
  // LRCLib sometimes has duplicate timestamps; sort just in case.
  out.sort((a, b) => a.t - b.t);
  return out;
}

async function fromLrc({ artist, title, duration }) {
  const url = new URL(LYRICS_API_BASE);
  url.searchParams.set('artist_name', artist);
  url.searchParams.set('track_name',  title);
  if (duration) url.searchParams.set('duration', String(duration));
  const res = await fetchWithTimeout(url, { headers: { 'User-Agent': LYRICS_USER_AGENT } });
  if (!res.ok) return null;
  const body = await res.json().catch(() => null);
  if (!body) return null;
  if (body.syncedLyrics) {
    const lines = parseLRC(body.syncedLyrics);
    if (lines.length) return { available: true, synced: true, lines, source: 'lrc' };
  }
  if (body.plainLyrics) {
    return { available: true, synced: false, plain: body.plainLyrics, source: 'lrc' };
  }
  return null;
}

async function fromCatalog(catalogId) {
  const url = new URL(CATALOG_API_BASE);
  url.searchParams.set('__call',      CATALOG_M_LYRICS);
  url.searchParams.set('lyrics_id',   catalogId);
  url.searchParams.set('_format',     'json');
  url.searchParams.set('_marker',     '0');
  url.searchParams.set('api_version', CATALOG_API_VERSION);
  url.searchParams.set('ctx',         CATALOG_CTX);
  const res = await fetchWithTimeout(url, { headers: { 'User-Agent': CATALOG_USER_AGENT } });
  if (!res.ok) return null;
  const body = await res.json().catch(() => null);
  if (!body) return null;
  const text = body.lyrics ?? body.lyrics_id ?? null;
  if (!text || typeof text !== 'string') return null;
  return { available: true, synced: false, plain: text.replace(/<br\s*\/?>/g, '\n').trim(), source: 'catalog' };
}

async function enrichWithEnglish(result, language) {
  if (!result?.available) return result;
  try {
    if (result.synced && Array.isArray(result.lines)) {
      const originals = result.lines.map(l => l.line ?? '');
      if (!originals.some(needsRomanization)) {
        return { ...result, has_english: false };
      }
      const roman = await romanizeLines(originals, language);
      return {
        ...result,
        has_english: true,
        lines: result.lines.map((l, i) => ({ ...l, line_en: roman[i] ?? l.line })),
      };
    }
    if (!result.synced && typeof result.plain === 'string') {
      if (!needsRomanization(result.plain)) {
        return { ...result, has_english: false };
      }
      const text = await romanizePlain(result.plain, language);
      return { ...result, has_english: true, plain_en: text };
    }
  } catch (err) {
    console.warn('[lyrics] romanize failed:', err.message);
  }
  return { ...result, has_english: false };
}

export async function getLyricsForTrack({ id, title, artist, durationSec, language }) {
  let result = null;
  if (title && artist) {
    try {
      result = await fromLrc({ artist, title, duration: durationSec });
    } catch (err) {
      // AbortError = our own timeout firing; fall through to the catalog silently.
      if (err.name !== 'AbortError') {
        console.warn('[lyrics] lrc failed:', err.name, err.message);
      }
    }
  }
  if (!result && id) {
    try {
      result = await fromCatalog(id);
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.warn('[lyrics] catalog failed:', err.message);
      }
    }
  }
  if (!result) return { available: false, synced: false };
  return enrichWithEnglish(result, language);
}
