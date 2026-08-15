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
  /\((?:full\s+)?(?:video|songs?|movie)\s*(?:songs?)?\)/gi,
  /\b(?:official\s+video|official\s+audio|official\s+trailer)\b/gi,
  // Unbracketed "Music Video". Only the BRACKETED form was covered, so
  // MEASURED on two mix rows: "Aura 10/10 - Music Video | Meesaya Murukku 2"
  // split on the hyphen and left the title as the bare word "Music" (the
  // trailing strip ate "Video" and stopped), and "Mutta Kalakki Music Video"
  // became "Mutta Kalakki Music". Stripped whole, before any split can see it.
  /\b(?:official\s+)?music\s+video\b/gi,
  // Slash-joined quality tags: "8K/4K", "4K/1080p". The individual tokens were
  // already handled, but never the pair — "Mudhal Nee Mudivum Nee Title Track
  // 8K/4K Video" kept a trailing "8K/" once its partner was stripped.
  /\b(?:8k|4k|hd|hq|1080p|720p)\s*\/\s*(?:8k|4k|hd|hq|1080p|720p)\b/gi,
  /\b(?:lyric[s]?\s*video|lyrical\s*video|lyrical)\b/gi,
  // Longest first: "Full Video Song" must not be eaten by "full video", which
  // strands a bare "Song" in the title. MEASURED on a real mix item —
  // "Gira Gira Full Video Song" cleaned to "Gira Gira Song".
  //
  // The PLURAL was missing everywhere, and it failed in both directions —
  // MEASURED on a 26-row Telugu playlist: "Evaraina Eppudaina Audio Songs |
  // Jukebox" kept the whole phrase and scored 0.000, while "Full Video Songs"
  // stripped only its head and left "X Songs" — precisely the orphan the note
  // above exists to prevent. Jukebox and compilation uploads are always plural.
  /\b(?:full\s+)?(?:video|audio|lyrical)\s+songs?\b/gi,
  /\b(?:full\s+songs?|full\s+video|video\s+songs?|full\s+audio)\b/gi,
  // "<Song> - Title Track" is the standard Kannada/Telugu label shape for a
  // film's namesake song. GENERIC_TITLES has known "title track" was meaningless
  // all along, but only downstream — by then the "A - B" split had already made
  // it an ARTIST, which spawned a whole second reading titled "Title Track" and
  // spent one of only two catalogue searches per video on it. Stripping it here,
  // as decoration, kills that at the source. Bracketed forms too, since
  // "(Title Track)" is just as common as the dashed one.
  /\(\s*title\s+(?:track|song)\s*\)/gi,
  /\[\s*title\s+(?:track|song)\s*\]/gi,
  /\btitle\s+(?:track|song)\b/gi,
  // "<Film> Kannada Movie | <Song> …". MOVIE_LABEL already strips this shape
  // when reading a film name out of pipe segment 2, but the HEAD never got the
  // same treatment — so "Durga Shakti Kannada Movie" reached both the catalog
  // query and the review screen with the label still attached. Requires the
  // word "movie", so an ordinary title containing a language name is untouched.
  /\b(?:kannada|tamil|telugu|malayalam|hindi|punjabi|marathi|bengali)?\s*movie\s+songs?\b/gi,
  /\b(?:kannada|tamil|telugu|malayalam|hindi|punjabi|marathi|bengali)\s+movie\b/gi,
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

/**
 * Trailing decoration, stripped repeatedly because it stacks.
 * Exported and applied to EACH SIDE of an "A - B" split as well as the whole
 * string: MEASURED, "Inthandham Song - Sita Ramam" kept "Song" on the title
 * after the split, dropping similarity to 0.667 on an otherwise exact match.
 * Only ever at the END — mid-title these words belong to real names.
 */
export function stripTrailingDecoration(input) {
  let s = String(input ?? '');
  let prev;
  do {
    prev = s;
    s = s.replace(
      // Longest first, as elsewhere in this file. `lyric` SINGULAR was missing
      // while `lyrics`/`lyrical` were present — found on the first live import:
      // "Master - Andha Kanna Paathaakaa Lyric | Thalapathy Vijay | …" parsed
      // to the title "Andha Kanna Paathaakaa Lyric". That one still matched,
      // but only because fuzzy scoring absorbed the extra token, and
      // "<song> Lyric | <cast>" is one of the most common Tamil/Telugu label
      // title shapes there is — so the drag was being paid across a whole class
      // of rows, not just this one.
      /[\s\-–—|]*\b(?:videos?|audio|songs?|official|lyrical|lyrics|lyric|quality|hd|hq|4k|8k|full)\b\s*$/i,
      '',
    );
  } while (s !== prev);
  return s.trim();
}

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
/**
 * "#SaradagaKasepaina" → "Saradaga Kasepaina".
 *
 * A promo hashtag glues the words together, and tokens() only splits on
 * whitespace — so the whole thing became ONE token and shared nothing with the
 * catalogue's ["saradaga", "kasepaina"]. MEASURED on a Telugu playlist: title
 * similarity 0.167, unmatched, against a candidate that was plainly correct.
 *
 * Deliberately narrow. Splitting camelCase anywhere in a title would wreck real
 * names, so this fires ONLY after a "#", and only on a lower→upper boundary —
 * which leaves acronym runs ("#ARRahman") alone rather than guessing at them.
 * "#Leharaayi", a single word, is untouched and already scored 0.917.
 */
export function splitHashtagWords(input) {
  return String(input ?? '').replace(
    /#(\p{L}[\p{L}\p{N}]*)/gu,
    (_, word) => ' ' + word.replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, '$1 $2'),
  );
}

export function cleanTitle(raw) {
  let s = splitHashtagWords(String(raw ?? '').replace(EMOJI, ' ').replace(EMOJI_GLUE, ''));
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
  // An UNMATCHED opener left behind by a strip: "Bel Air (Official Video)" can
  // lose its tail and leave "Bel Air (" — MEASURED on three KATSEYE rows.
  // Cosmetic for scoring (tokens drop punctuation) but it reaches the review
  // screen, where a title ending in a stray bracket looks like a broken app.
  if ((s.match(/\(/g) ?? []).length > (s.match(/\)/g) ?? []).length) {
    s = s.replace(/\s*\([^)]*$/, '');
  }
  // Trailing decoration, stripped repeatedly because it stacks:
  // "Poovukkul Official Quality Video" -> "Poovukkul".
  // MEASURED: seven rows in one mix kept a bare trailing "Video"/"Official"/
  // "8K"/"Song", each dragging title similarity from 1.0 down to ~0.92 or
  // 0.667 and pushing a correct match out of auto. Only stripped at the END —
  // mid-title these words can be part of a real name.
  s = stripTrailingDecoration(s);
  // Separator debris at BOTH ends. The trailing strip has always been here; the
  // leading one was needed once a noise phrase could sit at the head — the
  // existing suite caught it immediately: "Title Track - Mugulu Nage" cleaned to
  // "- Mugulu Nage". Symmetric, because a title never legitimately opens with a
  // dangling dash or comma either.
  return s.replace(/\s{2,}/g, ' ')
    .replace(/^[\s\-–—_,.]+/g, '')
    .replace(/[\s\-–—_,.]+$/g, '')
    .trim();
}

// "SIR Telugu Movie" → "SIR". A label writes the language and the word "movie"
// into the segment; neither is part of the film's name.
const MOVIE_LABEL = /\b(?:telugu|tamil|kannada|malayalam|hindi|movie|film|cinema|songs?|jukebox|lyrical|video)\b/gi;

// The same label, but ANCHORED to the end of a string — a suffix, where an
// uploader actually writes it.
const FILM_LABEL_SUFFIX =
  /\b(?:kannada|tamil|telugu|malayalam|hindi|punjabi|marathi|bengali)?\s*movie(?:\s+songs?)?\s*$/i;

/**
 * Does the head of this title announce itself as a FILM?
 *
 * "Durga Shakti Kannada Movie | Om Shakthi Jaya Jaya" is not an ambiguous
 * title — the uploader said which half is the film. cleanTitle strips that
 * label as noise, which is right for the query but threw away the only evidence
 * of which half was the song, and the film name was then searched as if it were
 * one. MEASURED: two rows went from unmatched/review to CONFIDENTLY WRONG auto,
 * because the catalog holds real songs named after films (a DJ single called
 * "Durga Shakti") and the album tell in ytSearch cannot see those.
 *
 * Read from the RAW title, before cleanTitle removes the label.
 *
 * Anchored deliberately. Unanchored it also fires on "Movie Star", which is a
 * name rather than a label — the marker only means what we want it to mean when
 * it TRAILS the head.
 */
export function headIsFilmLabelled(rawTitle) {
  const raw = String(rawTitle ?? '');
  if (!raw.includes('|')) return false;
  return FILM_LABEL_SUFFIX.test(raw.split('|')[0].trim());
}

/**
 * Recover the film name from the SECOND pipe segment.
 *
 * cleanTitle keeps only the head — right for the title, but it throws away the
 * one piece of corroborating evidence these uploads reliably carry. MEASURED on
 * 53 Telugu/Kannada rows: the review pile was dominated by correct matches with
 * a perfect title that could not reach auto, because a "Full Video Song" is the
 * film cut and runs far longer than the audio track the catalogue holds, so
 * duration — the only other corroboration when no artist is known — failed.
 *
 * Recovering the movie flipped one such row from review 0.819 to auto 0.902,
 * same candidate and same duration gap.
 *
 * A wrong guess is CHEAP by construction: the movie only ever raises sanity when
 * it agrees with the candidate's album, and that comparison is now token-based,
 * so a segment holding an artist or a channel name simply scores 0 — exactly
 * what happens today when there is no movie at all.
 */
export function movieFromPipeSegments(rawTitle) {
  const parts = String(rawTitle ?? '').split('|').map(s => s.trim()).filter(Boolean);
  if (parts.length < 2) return null;

  let seg = splitHashtagWords(parts[1]);
  for (const re of NOISE_PATTERNS) seg = seg.replace(re, ' ');
  seg = seg.replace(MOVIE_LABEL, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/^[\s\-–—_,.]+/, '')
    .replace(/[\s\-–—_,.]+$/, '')
    .trim();

  if (!seg || isGenericTitle(seg)) return null;
  // A single short token is where a false album substring used to come from, and
  // it is rarely a film name on its own.
  if (seg.length < 3 || seg.length > 60) return null;
  return seg;
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
 * Phrases that are never a song name. MEASURED on a real mix: the pipe-split
 * kept heads like "Title Track Video", "Official" and "Title Track", each of
 * which is a label for a track rather than its name — and none could ever match
 * anything. When the head is generic the real name is on the other side.
 */
const GENERIC_TITLES = new Set([
  'title track',
  'title song',
  'title track video',
  'official',
  'official video',
  'video',
  'audio',
  'song',
  'lyrical',
  'lyric video',
  'teaser',
  'trailer',
  'promo',
  'theme',
  'theme music',
  'bgm',
]);

export function isGenericTitle(t) {
  const k = String(t ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  return k === '' || GENERIC_TITLES.has(k);
}

/**
 * Both readings of "A - B", because the convention is genuinely inconsistent
 * and the parser cannot know which applies.
 *
 * MEASURED on one 50-track mix, both orders present:
 *   "Tulasi - Sumedh K"            song first, artist second  (Indian norm)
 *   "TREAM X BAUSA - DER SONNE …"  artist first, song second  (Western norm)
 *
 * Guessing one direction gets the other class wrong every time, and the failure
 * is silent — we search the catalog for an artist name and find nothing. So we
 * emit BOTH readings and let scoring against real candidates decide, which is
 * the only place the evidence actually exists.
 */
export function parseVideoVariants(video) {
  const primary = parseVideo(video);
  // Art Tracks carry structured credits; there is nothing to guess.
  if (primary.source === SOURCE.ART_TRACK) return [primary];

  const swapped = primary.artists.length
    ? { ...primary, title: primary.artists[0], artists: [primary.title] }
    : null;

  // A generic head is not ambiguous — it is simply wrong, so the swap leads.
  if (swapped && isGenericTitle(primary.title)) return [swapped, primary];
  // The mirror case, and the one that was costing us: if the SWAP's title is
  // generic, the swap is not a rival reading at all — nobody released a song
  // called "Title Track" or "Official Video". Emitting it anyway spends one of
  // only two catalogue searches per video (MAX_SEARCHES_PER_ITEM) on a query
  // built from a phrase isGenericTitle already rejects everywhere else. Drop it
  // rather than rank it: an ambiguity with one meaningful side is not ambiguous.
  if (swapped && isGenericTitle(swapped.title)) return [primary];
  if (swapped) return [primary, swapped];

  // No hyphen to swap on — but the PIPE carries the same ambiguity, and we had
  // only ever read it one way.
  //
  // "Kaagadada Doniyalli | Kirik Party" is SONG | MOVIE. "Milana | Ninnindale"
  // is MOVIE | SONG, and the parser called the film the song and the song the
  // film. MEASURED on one 30-row mix: Milana, Durga Shakti, Aasai Aasaiyai and
  // Pooparika Varugirom, plus Bachchan and Krishnan Love Story on the Kannada
  // list — the largest remaining error class, and the one that lands WRONG
  // tracks in a playlist rather than merely missing them.
  //
  // Same answer as the hyphen: do not guess a direction, emit both and let the
  // catalog decide. The film reading is second because SONG | MOVIE is the more
  // common shape, and reading order decides which query runs first.
  const pipeSwapped = primary.movie && !isGenericTitle(primary.movie)
    ? { ...primary, title: primary.movie, movie: primary.title }
    : null;
  if (!pipeSwapped) return [primary];

  // …unless the title SAID which half is the film, in which case there is no
  // ambiguity left to resolve and the song reading leads.
  //
  // This is the correction to that first assumption. Emitting both readings
  // still relies on the catalog to pick, and for "Durga Shakti Kannada Movie"
  // the catalog picks WRONG: it holds a DJ single genuinely titled "Durga
  // Shakti", so the film query returns a perfect title match whose album is not
  // the film — invisible to ytSearch's album tell — and the loop stops before
  // the real song is ever searched. Both rows landed on confident, wrong autos.
  //
  // Leading with the song is also CHEAPER: the right query answers first, so it
  // costs one search rather than two.
  if (headIsFilmLabelled(video?.title)) return [pipeSwapped, primary];
  return [primary, pipeSwapped];
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
  // An explicit (From "…") wins; the pipe segment is the fallback.
  const film = movie ?? movieFromPipeSegments(video?.title);

  // "Artist - Title" on the FIRST hyphen. Only when both sides look real;
  // a leading hyphen or a one-character side means it was punctuation, not a
  // separator.
  let title = rest;
  let artists = topicArtist ? [topicArtist] : [];
  const split = rest.match(/^(.{2,60}?)\s+[-–—]\s+(.{2,})$/);
  if (split && !topicArtist) {
    artists = [stripTrailingDecoration(split[1].trim())];
    title = stripTrailingDecoration(split[2].trim());
  } else if (split && topicArtist) {
    // A Topic channel already told us the artist; the hyphen is then usually
    // "Artist - Title" repeating it, so prefer the right-hand side as title.
    title = stripTrailingDecoration(split[2].trim());
  }

  return {
    source,
    title,
    artists,
    movie: film,
    album: null,
    year: null,
    versions: versionsIn(video?.title ?? ''),
    durationSec: video?.durationSec ?? null,
  };
}
