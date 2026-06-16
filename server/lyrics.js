// Lyrics fetcher. First walks the synced-lyrics provider chain (LRCLIB →
// Musixmatch → NetEase) for line-timed lyrics. If none has the song, it falls
// back to the catalog's own PLAIN (untimed) lyrics — better to show readable
// text than nothing for the regional long tail the synced providers miss. When
// the lines are in a non-Latin script we also attach a romanized (English-script)
// version via Gemini, so callers can toggle original ⇄ singable Latin. When even
// plain lyrics are absent, we report it as needing generation; the caller (the
// lyrics endpoint) decides whether to queue an audio-based job.
//
// Returns one of:
//   { available: true,  synced: true,  lines: [{t, line, line_en?}, ...], has_english, source }
//   { available: true,  synced: false, lines: [{line, line_en?}, ...],    has_english, source } // plain
//   { available: false, synced: false, needs_generation: true }

import { needsRomanization, romanizeLines } from './prompts/romanize.js';
import { getSyncedLyrics } from './lyricsProviders/index.js';
import { getPlainLyrics } from './catalog.js';

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

export async function getLyricsForTrack({ trackId, title, artist, durationSec, language }) {
  const synced = await getSyncedLyrics({ artist, title, durationSec });
  if (synced) {
    const enriched = await enrichWithEnglish(synced, language);   // { lines, source, has_english }
    return { available: true, synced: true, ...enriched };
  }
  // No synced match in any provider → fall back to the catalog's own plain
  // (untimed) lyrics. Still romanize so non-Latin scripts get a singable view.
  const plain = await getPlainLyrics(trackId).catch(() => null);
  if (plain?.lines?.length) {
    const enriched = await enrichWithEnglish(plain, language);    // { lines, source, has_english }
    return { available: true, synced: false, ...enriched };
  }
  return { available: false, synced: false, needs_generation: true };
}
