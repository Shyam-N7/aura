// Turn a YouTube video into something matchable.
//
// YouTube hands us a video title and a channel name. JioSaavn wants a track and
// an artist. Everything hard about this feature lives in that gap, and there are
// two quite different roads across it:
//
//   TIER 1 — Art Tracks. A "<Artist> - Topic" upload carries a machine-written
//   description block ("Provided to YouTube by …") with the track, artists and
//   album on ` · `-separated lines. That is structured metadata, not a guess,
//   and when present it should beat anything parsed from the title.
//
//   TIER 2 — everything else. Strip the noise humans add to titles, then split
//   on the first hyphen. Every surveyed implementation converges on that, and
//   it is right far more often than it is wrong.
//
// Nothing here calls the network or the catalog. Pure string work, so it is
// cheap to test against real titles — which is the only way to know it works.

/** How much to trust duration, decided by where the video came from. */
export const SOURCE = {
  ART_TRACK: 'art_track', // "- Topic" / Provided-to-YouTube — same masters
  MUSIC_VIDEO: 'music_video', // intros, dialogue, credits inflate length
  UNKNOWN: 'unknown',
};

// Order matters only in that longer patterns must not be swallowed by shorter
// ones; these are all anchored to bracket groups or word boundaries.
const NOISE_PATTERNS = [
  /\((?:official\s+)?(?:music\s+)?video(?:\s+song)?\)/gi,
  /\((?:official\s+)?(?:audio|lyric[s]?|lyrical|visuali[sz]er|teaser|trailer)\)/gi,
  /\[(?:official\s+)?(?:music\s+)?video\]/gi,
  /\[(?:audio|lyric[s]?|lyrical|visuali[sz]er|hd|hq|4k|full\s*hd)\]/gi,
  /\((?:full\s+)?(?:video|song|movie)\s*(?:song)?\)/gi,
  /\b(?:official\s+video|official\s+audio|official\s+trailer)\b/gi,
  /\b(?:lyric[s]?\s*video|lyrical\s*video|lyrical)\b/gi,
  // Longest first: "Full Video Song" must not be eaten by "full video", which
  // strands a bare "Song" in the title. MEASURED on a real mix item —
  // "Gira Gira Full Video Song" cleaned to "Gira Gira Song".
  /\b(?:full\s+)?(?:video|audio|lyrical)\s+song\b/gi,
  /\b(?:full\s+song|full\s+video|video\s+song|full\s+audio)\b/gi,
  /\b(?:hd|hq|4k|1080p|720p|remaster(?:ed)?(?:\s+\d{4})?)\b/gi,
  /\bwith\s+lyrics\b/gi,
  /\bout\s+now\b/gi,
  // Bracketed feature credit must be removed WHOLE. Stripping the inner text
  // with the bare FEAT pattern below leaves an orphan "(" behind — which is
  // exactly what "Perfect (feat. Beyoncé) (Official Audio)" produced before
  // this line existed.
  /\((?:feat|ft|featuring|with)\.?\s+[^)]*\)/gi,
  /\[(?:feat|ft|featuring|with)\.?\s+[^\]]*\]/gi,
];

// Version words must AGREE on both sides or the match is capped — see ytMatch.
// Kept separate from noise for that reason: these are signal, not clutter.
export const VERSION_WORDS = [
  'remix',
  'lofi',
  'lo-fi',
  'slowed',
  'reverb',
  'reprise',
  'unplugged',
  'acoustic',
  'cover',
  'live',
  'instrumental',
  'karaoke',
  'mashup',
  'sped up',
  'nightcore',
  'extended',
  'radio edit',
];

const FEAT = /\b(?:feat|ft|featuring|with)\.?\s+[^([\-|]+/gi;

// Emoji + pictographs. Titles are full of them and they never carry meaning
// for matching.
// Property escapes rather than hand-rolled ranges: they cover every pictograph
// block without listing them, and they keep the variation selector OUT of the
// class (VS16 combines with the preceding character, which is what made the
// hand-rolled version a misleading character class).
// Extended_Pictographic ONLY. \p{Emoji_Component} looks tempting and is a trap:
// it includes ASCII digits 0-9 (they are keycap components), so it silently ate
// the "4" from "[4K]" and the "2" from "Aashiqui 2". Variation selectors and
// ZWJ are stripped separately below rather than joining the class, since a
// combining character inside one is what made the original version misleading.
const EMOJI = /\p{Extended_Pictographic}/gu;
const EMOJI_GLUE = /[\uFE0E\uFE0F\u200D]/g;

/**
 * Bollywood/regional convention: `Kesariya (From "Brahmastra")`.
 * Appears on BOTH sides — JioSaavn writes it and YouTube titles often echo it —
 * so the movie is a matching SIGNAL, not noise to discard. We strip it from the
 * title for comparison and return it separately.
 * Curly quotes are not optional: the provider uses them as often as straight.
 */
const FROM_MOVIE = /\(\s*from\s*["“”'']([^"“”'']+)["“”'']\s*\)/i;

/** Collapse to comparable tokens. Diacritics folded, punctuation dropped. */
export function tokens(s) {
  if (!s) return [];
  return String(s)
    .normalize('NFD')
    // Combining diacritical marks. Written as escapes, not literals: as literal
    // characters they are invisible in an editor and eslint flags the class as
    // misleading, which it is.
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    // Keep letters, numbers and combining marks in ANY script, drop everything
    // else as punctuation. Property escapes rather than an explicit Indic range:
    // \p{M} is what carries Devanagari/Tamil/Telugu vowel signs, and spelling
    // the range out by hand both missed scripts and tripped
    // no-misleading-character-class.
    .replace(/[^\p{L}\p{N}\p{M}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/** Which version words appear in a string. */
export function versionsIn(s) {
  const hay = ` ${String(s ?? '').toLowerCase()} `;
  return VERSION_WORDS.filter(w => hay.includes(` ${w} `) || hay.includes(`(${w}`) || hay.includes(`${w})`));
}

/** Strip the noise humans add to video titles. */
export function cleanTitle(raw) {
  let s = String(raw ?? '').replace(EMOJI, ' ').replace(EMOJI_GLUE, '');
  for (const re of NOISE_PATTERNS) s = s.replace(re, ' ');
  s = s.replace(FEAT, ' ');
  // Pipe-separated junk: "Song | Movie | Label | 2022". Keep only the head —
  // the tail is almost always credits, never the title.
  if (s.includes('|')) s = s.split('|')[0];
  // Runs of 2+ spaces are the SAME separator. MEASURED on a real mix item:
  // "Munjane Manjalli   Audio Song   Just Maath Maathali   Kiccha Sudeep …" —
  // an amateur reupload using spaces where a label would use pipes. Without
  // this the entire credit list becomes the title and nothing can match it.
  else if (/\S {2,}\S/.test(s)) s = s.split(/ {2,}/)[0];
  // Any bracket left empty by the strips above is debris, not content.
  s = s.replace(/\(\s*\)/g, ' ').replace(/\[\s*\]/g, ' ');
  return s.replace(/\s{2,}/g, ' ').replace(/[\s\-–—_,.]+$/g, '').trim();
}

/** Pull `(From "Movie")` out, returning the movie and the title without it. */
export function extractMovie(raw) {
  const s = String(raw ?? '');
  const m = s.match(FROM_MOVIE);
  if (!m) return { movie: null, rest: s };
  return { movie: m[1].trim(), rest: s.replace(FROM_MOVIE, ' ').replace(/\s{2,}/g, ' ').trim() };
}

/**
 * Parse the auto-generated Art Track description.
 *
 *   Provided to YouTube by <distributor>
 *
 *   <Track> · <Artist> · <Artist> …
 *
 *   <Album>
 *
 *   ℗ 2022 <label>
 *   Released on: 2022-07-17
 *
 * Returns null when the block isn't present, which is the signal to fall back
 * to title parsing rather than an error.
 */
export function parseArtTrackDescription(description) {
  const text = String(description ?? '');
  if (!/provided to youtube by/i.test(text)) return null;

  const lines = text.split(/\r?\n/).map(l => l.trim());
  const start = lines.findIndex(l => /provided to youtube by/i.test(l));
  const after = lines.slice(start + 1).filter(l => l !== '');
  if (after.length === 0) return null;

  const creditLine = after[0];
  if (!creditLine.includes('·')) return null;

  const parts = creditLine.split('·').map(p => p.trim()).filter(Boolean);
  const title = parts[0] ?? null;
  const artists = parts.slice(1);
  if (!title) return null;

  const album = after[1] && !after[1].includes('·') && !/^[℗©]/.test(after[1])
    ? after[1]
    : null;

  const released = text.match(/released on:\s*(\d{4})/i);
  const phono = text.match(/[℗©]\s*(\d{4})/);
  const year = Number(released?.[1] ?? phono?.[1]) || null;

  const { movie, rest } = extractMovie(title);
  return {
    title: rest || title,
    artists,
    album,
    year,
    movie: movie ?? (album && /^[^()]+$/.test(album) ? null : null),
  };
}

/** `"Arijit Singh - Topic"` → `"Arijit Singh"`, else null. */
export function topicChannelArtist(channel) {
  const m = String(channel ?? '').match(/^(.*?)\s*-\s*Topic$/i);
  return m ? m[1].trim() : null;
}

/**
 * Full parse of one YouTube video into matchable fields.
 * `video` is { title, channelTitle, description, durationSec }.
 */
export function parseVideo(video) {
  const channel = video?.channelTitle ?? '';
  const topicArtist = topicChannelArtist(channel);
  const art = parseArtTrackDescription(video?.description);

  const source = art || topicArtist ? SOURCE.ART_TRACK : SOURCE.MUSIC_VIDEO;

  if (art) {
    return {
      source: SOURCE.ART_TRACK,
      title: art.title,
      artists: art.artists.length ? art.artists : topicArtist ? [topicArtist] : [],
      movie: art.movie ?? extractMovie(art.album ?? '').movie,
      album: art.album,
      year: art.year,
      versions: versionsIn(art.title),
      durationSec: video?.durationSec ?? null,
    };
  }

  // Tier 2 — title parsing.
  const cleaned = cleanTitle(video?.title);
  const { movie, rest } = extractMovie(cleaned);

  // "Artist - Title" on the FIRST hyphen. Only when both sides look real;
  // a leading hyphen or a one-character side means it was punctuation, not a
  // separator.
  let title = rest;
  let artists = topicArtist ? [topicArtist] : [];
  const split = rest.match(/^(.{2,60}?)\s+[-–—]\s+(.{2,})$/);
  if (split && !topicArtist) {
    artists = [split[1].trim()];
    title = split[2].trim();
  } else if (split && topicArtist) {
    // A Topic channel already told us the artist; the hyphen is then usually
    // "Artist - Title" repeating it, so prefer the right-hand side as title.
    title = split[2].trim();
  }

  return {
    source,
    title,
    artists,
    movie,
    album: null,
    year: null,
    versions: versionsIn(video?.title ?? ''),
    durationSec: video?.durationSec ?? null,
  };
}
