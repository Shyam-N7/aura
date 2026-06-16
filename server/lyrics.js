// Lyrics fetcher. Walks the synced-lyrics provider chain (LRCLIB → Musixmatch →
// NetEase) and returns ONLY synced, line-timed lyrics — the app never shows plain
// text. When the lines are in a non-Latin script we also attach a romanized
// (English-script) version via Gemini, so callers can toggle original ⇄ singable
// Latin. When no provider has the song, we report it as needing generation; the
// caller (the lyrics endpoint) decides whether to queue an audio-based job.
//
// Returns one of:
//   { available: true,  synced: true,  lines: [{t, line, line_en?}, ...], has_english, source }
//   { available: false, synced: false, needs_generation: true }

import { needsRomanization, romanizeLines } from './prompts/romanize.js';
import { getSyncedLyrics } from './lyricsProviders/index.js';

// Attach an English-script romanization to non-Latin synced lines. Shared by the
// fetch path here and the generation worker (which produces synced lines too).
export async function enrichWithEnglish(result, language) {
  if (!result?.lines?.length) return { ...result, has_english: false };
  try {
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
  } catch (err) {
    console.warn('[lyrics] romanize failed:', err.message);
    return { ...result, has_english: false };
  }
}

export async function getLyricsForTrack({ title, artist, durationSec, language }) {
  const synced = await getSyncedLyrics({ artist, title, durationSec });
  if (!synced) return { available: false, synced: false, needs_generation: true };
  const enriched = await enrichWithEnglish(synced, language);   // { lines, source, has_english }
  return { available: true, synced: true, ...enriched };
}
