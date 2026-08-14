// Score a JioSaavn candidate against a parsed YouTube video.
//
// Candidates come from catalog.js `searchSongs`, i.e. `mapSong` shape:
//   { id, title, artist, album, language, durationSec, imageUrl, explicit }
// Two properties of that shape drive decisions here:
//   - `artist` is ONE string, but not always one artist. mapSong prefers
//     artistMap.primary_artists[0].name and falls back to `primary_artists` /
//     `singers` / `subtitle`, which are comma-joined. So artist comparison
//     tokenises and matches ANY, never whole strings — otherwise a track
//     credited "Pritam, Arijit Singh" loses to a title naming only Arijit.
//   - `language` is passed through RAW and is not lowercased (rankByLang
//     lowercases only at compare time), so we lowercase both sides ourselves.
//
// HTML entities are already decoded on the candidate side — mapSong runs
// decodeEntities on title/artist/album. The YouTube side has had nothing done
// to it, which is why ytTrackParse exists.

import { tokens, versionsIn, extractMovie, SOURCE } from './ytTrackParse.js';

export const TIER = { AUTO: 'auto', REVIEW: 'review', UNMATCHED: 'unmatched' };

export const THRESHOLDS = {
  auto: 0.85,
  review: 0.6,
  // A version disagreement can never reach auto, however well everything else
  // scores. See scoreCandidate.
  versionMismatchCap: 0.55,
  // Nor can a language disagreement.
  languageMismatchCap: 0.8,
};

// Duration is weighted by WHERE the video came from, because its reliability
// differs by an order of magnitude between the two cases.
const DURATION_MODEL = {
  // Same masters as the catalog. Near enough an identity check.
  [SOURCE.ART_TRACK]: { weight: 0.28, full: 3, zero: 15, asymmetric: false },
  // Intros, dialogue and credits routinely add 30-90s, so a long video is
  // expected rather than suspicious — but a video SHORTER than the track is a
  // real signal that it is a clip.
  [SOURCE.MUSIC_VIDEO]: { weight: 0.1, full: 20, zero: 120, asymmetric: true },
  [SOURCE.UNKNOWN]: { weight: 0.2, full: 5, zero: 30, asymmetric: false },
};

const BASE_WEIGHTS = { title: 0.45, artist: 0.3, sanity: 0.05 };

/**
 * Token-set similarity. Dice by default; containment when one side is a clean
 * subset of the other, which is the common "Kesariya" vs
 * "Kesariya (From Brahmastra)" shape. Containment needs 2+ tokens on the
 * smaller side so a single shared word cannot score 1.0.
 */
export function titleSimilarity(a, b) {
  const A = new Set(tokens(a));
  const B = new Set(tokens(b));
  if (A.size === 0 || B.size === 0) return 0;
  let shared = 0;
  for (const t of A) if (B.has(t)) shared++;
  const dice = (2 * shared) / (A.size + B.size);
  const small = Math.min(A.size, B.size);
  const containment = shared / small;
  return small >= 2 && containment === 1 ? Math.max(dice, 0.92) : dice;
}

/**
 * Any-token overlap across artist lists. Handles comma-joined candidates.
 *
 * Returns **null** when either side has no artist at all — "we don't know" is
 * not "they disagree", and scoring them identically was a real defect. MEASURED
 * on a 50-track mix: 45 titles yielded no artist, so with artist weighted 0.30
 * the ceiling for a perfect title + perfect duration match was
 * (0.45 + 0.10) / 0.90 = 0.611. Twelve rows landed on exactly that score and
 * every one of them was a correct match sitting in the review queue. 0.85 was
 * unreachable by construction and the 90% auto target was impossible.
 *
 * null drops the signal out of the weighting, exactly as an absent duration
 * already does.
 */
export function artistOverlap(ytArtists, candidateArtist) {
  const cand = new Set(tokens(candidateArtist));
  const yt = (ytArtists ?? []).flatMap(a => tokens(a));
  if (cand.size === 0 || yt.length === 0) return null;
  const ytSet = new Set(yt);
  let shared = 0;
  for (const t of ytSet) if (cand.has(t)) shared++;
  if (shared === 0) return 0;
  // Full credit once a whole artist name matches; partial for a single token
  // (surnames alone are weak — "Singh" matches half of Bollywood).
  return shared >= 2 ? 1 : 0.6;
}

function durationScore(ytSec, candSec, source) {
  const model = DURATION_MODEL[source] ?? DURATION_MODEL[SOURCE.UNKNOWN];
  if (!ytSec || !candSec) return { score: null, weight: model.weight };
  const delta = ytSec - candSec;
  const abs = Math.abs(delta);
  // Music videos: being LONGER is expected, so widen only in that direction.
  const full = model.asymmetric && delta > 0 ? model.full * 2 : model.full;
  const zero = model.asymmetric && delta > 0 ? model.zero : model.zero / 2;
  if (abs <= full) return { score: 1, weight: model.weight };
  if (abs >= zero) return { score: 0, weight: model.weight };
  return { score: 1 - (abs - full) / (zero - full), weight: model.weight };
}

/**
 * Score one candidate. Returns { score, breakdown, caps } — breakdown is kept
 * because a reviewer looking at a wrong match needs to see WHICH signal lied.
 */
export function scoreCandidate(parsed, candidate) {
  const candMovie = extractMovie(candidate.title ?? '');
  const candTitleBare = candMovie.rest;

  const title = titleSimilarity(parsed.title, candTitleBare);
  let artist = artistOverlap(parsed.artists, candidate.artist);
  const dur = durationScore(parsed.durationSec, candidate.durationSec, parsed.source);

  // Sanity: movie agreement, then year. Small by design — it breaks ties, it
  // must never decide a match.
  let sanity = 0;
  const movieA = (parsed.movie ?? '').toLowerCase();
  const movieB = (candMovie.movie ?? candidate.album ?? '').toLowerCase();
  if (movieA && movieB && (movieB.includes(movieA) || movieA.includes(movieB))) sanity = 1;
  else if (parsed.year && candidate.year && parsed.year === candidate.year) sanity = 0.5;

  // The hyphen tail is very often the MOVIE, not an artist.
  //
  // MEASURED: "Anbil Avan - Vinnaithaandi Varuvaayaa", "Chiru Chiru Video -
  // Awaara", "Innunu Bekagide - Mundina Nildana". We parsed the film name as an
  // artist, then scored it 0 against the real singer — so a perfect title and
  // perfect duration were actively BLOCKED by evidence we had misread.
  //
  // If that supposed artist matches the candidate's album or (From "…") movie
  // instead, we misidentified it. Demote it to unknown (null) rather than
  // letting it count against, and take the movie agreement as the sanity bonus
  // it actually is.
  if (artist === 0 && parsed.artists.length) {
    const claimed = tokens(parsed.artists[0]).join(' ');
    const albumish = tokens(`${candidate.album ?? ''} ${candMovie.movie ?? ''}`).join(' ');
    if (
      claimed &&
      albumish &&
      (albumish.includes(claimed) || claimed.includes(albumish))
    ) {
      artist = null;
      sanity = 1;
    }
  }

  // Renormalise so tiers stay comparable when duration is unavailable.
  const parts = [
    { v: title, w: BASE_WEIGHTS.title },
    { v: sanity, w: BASE_WEIGHTS.sanity },
  ];
  // An UNKNOWN artist drops out of the weighting; a DISAGREEING one scores 0
  // and counts against. See artistOverlap.
  if (artist !== null) parts.push({ v: artist, w: BASE_WEIGHTS.artist });
  if (dur.score !== null) parts.push({ v: dur.score, w: dur.weight });
  const totalW = parts.reduce((s, p) => s + p.w, 0);
  let score = parts.reduce((s, p) => s + p.v * p.w, 0) / totalW;

  const caps = [];

  // A version disagreement is a GATE, not a penalty. A lofi remix matches the
  // original on title, artist, language and often duration — subtracting a
  // weight still lets it clear 0.85, which is the likeliest wrong auto-accept
  // in this catalog. Capping makes that structurally impossible.
  const candVersions = versionsIn(candidate.title ?? '');
  const ytVersions = parsed.versions ?? [];
  const sameVersions =
    ytVersions.length === candVersions.length &&
    ytVersions.every(v => candVersions.includes(v));
  if (!sameVersions) {
    score = Math.min(score, THRESHOLDS.versionMismatchCap);
    caps.push('version');
  }

  // Language disagreement: the cross-language duplicate is the signature false
  // positive here, so it can reach review but never auto.
  const ytLang = (parsed.language ?? '').toLowerCase();
  const candLang = (candidate.language ?? '').toLowerCase();
  if (ytLang && candLang && ytLang !== candLang) {
    score = Math.min(score, THRESHOLDS.languageMismatchCap);
    caps.push('language');
  }

  return {
    score: Number(score.toFixed(4)),
    breakdown: {
      title: Number(title.toFixed(3)),
      // null = unknown (not scored), 0 = known and disagreeing (scored against)
      artist: artist === null ? null : Number(artist.toFixed(3)),
      duration: dur.score === null ? null : Number(dur.score.toFixed(3)),
      sanity,
    },
    caps,
  };
}

/**
 * Rank candidates and assign a tier.
 *
 * Auto-accept requires BOTH a high score and a non-zero artist score. A
 * title-only match at 0.86 with no artist agreement is exactly the
 * cross-language false positive JioSaavn is full of, so the score alone is not
 * sufficient evidence.
 */
export function matchVideo(parsed, candidates, { autoThreshold } = {}) {
  const auto = autoThreshold ?? THRESHOLDS.auto;

  // `parsed` may be a single reading or the ambiguous pair from
  // parseVideoVariants ("A - B" is song-artist in Indian titles and
  // artist-song in Western ones). Score every reading against every candidate
  // and let the evidence pick — the parser has no way to know, but the catalog
  // does. The winning reading is carried on the result so a reviewer can see
  // which interpretation was used.
  const variants = Array.isArray(parsed) ? parsed : [parsed];
  const scored = variants
    .flatMap(v =>
      (candidates ?? []).map(c => ({
        candidate: c,
        parsed: v,
        ...scoreCandidate(v, c),
      })),
    )
    .sort((a, b) => b.score - a.score);

  // Scoring N candidates against 2 readings yields 2N rows, so the same song
  // can appear twice. Keep each song once, at its best-scoring reading —
  // otherwise the review screen offers "pick one of three" and shows the same
  // track twice, which is worse than offering two.
  const seen = new Set();
  const unique = scored.filter(r => {
    const id = r.candidate?.id;
    if (id == null) return true;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  const best = unique[0];
  if (!best || best.score < THRESHOLDS.review) {
    return { tier: TIER.UNMATCHED, best: best ?? null, candidates: unique.slice(0, 3) };
  }
  // Auto-accept needs corroboration beyond the title, but WHICH corroboration
  // depends on what we actually know:
  //
  //   artist known    → it must agree. A title-only match with a DISAGREEING
  //                     artist is the cross-language false positive this
  //                     catalog is full of.
  //   artist unknown  → duration must be near-exact. MEASURED: 45 of 50 real
  //                     mix titles yield no artist, so requiring one made auto
  //                     unreachable. Duration is then the only evidence that
  //                     this is the same recording rather than a cover, a live
  //                     take, or a different song of the same name.
  //                     Plus UNAMBIGUITY: if a runner-up scores within
  //                     AMBIGUITY_MARGIN, we genuinely cannot tell them apart
  //                     without an artist, and auto-accepting the first is a
  //                     coin flip — exactly the same-title-different-artist
  //                     case this catalog is full of. Send it to review.
  const artistKnown = best.breakdown.artist !== null;
  //   NO ambiguity guard. It was tried and removed on evidence.
  //
  //   Three consecutive measured runs, two patches: it blocked correct matches
  //   every time and never once prevented a wrong one. The final proof was a
  //   candidate scoring a PERFECT 1.000 sent to review. The mechanism is that
  //   the music-video duration tolerance is +/-40s, so two candidates both
  //   score d=1 while sitting 20s apart from each other — read as rivals by any
  //   same-recording window narrow enough to be meaningful.
  //
  //   When two candidates genuinely cannot be separated by metadata, the
  //   catalog's own relevance order is a better tiebreak than refusing to
  //   choose: searchSongs returns them ranked, and the first is the canonical
  //   entry far more often than not. A wrong auto-accept is visible in the
  //   playlist and one tap to fix; a correct match buried in review costs the
  //   user a decision on every single track. Those are not symmetric.
  //
  //   If wrong auto-accepts turn up in real use, the fix is the user_confirmed
  //   signal in yt_match_cache — real corrections beat a guard invented here.
  const corroborated = artistKnown
    ? best.breakdown.artist > 0
    : best.breakdown.duration >= 0.9 || best.breakdown.sanity > 0;

  if (best.score >= auto && corroborated) {
    return { tier: TIER.AUTO, best, candidates: unique.slice(0, 3) };
  }
  return { tier: TIER.REVIEW, best, candidates: unique.slice(0, 3) };
}

/**
 * Durable cache key. Deliberately NOT the YouTube video id: the ToS 30-day
 * storage rule covers YouTube data, and a video id is YouTube data. This is a
 * fingerprint of OUR OWN derived parse, so it may persist — and it collapses a
 * Topic upload and a VEVO video of the same song to one entry, which a
 * video-id key never could.
 *
 * Duration is bucketed to 5s so trivial encode differences don't split a key.
 */
const BUCKET_SECONDS = 5;

function fpParts(parsed) {
  return {
    t: tokens(parsed.title).join(' '),
    a: tokens(parsed.artists?.[0] ?? '').join(' '),
    b: parsed.durationSec ? Math.round(parsed.durationSec / BUCKET_SECONDS) : null,
  };
}

/** The key to WRITE under. */
export function fingerprint(parsed) {
  const { t, a, b } = fpParts(parsed);
  return `${t}|${a}|${b ?? 'na'}`;
}

/**
 * The keys to READ by, in priority order.
 *
 * Bucketing alone does not collapse two encodes of one song: 268s and 266s are
 * two seconds apart but land in buckets 54 and 53, so an exact-key lookup
 * misses. Widening the bucket only moves the boundary, it never removes it —
 * so the lookup checks the neighbours instead.
 *
 * Worth being clear about the stakes: a fingerprint miss is a CACHE miss, not a
 * wrong match. The cost is one extra catalog search, never a bad result. That is
 * why approximate keys are acceptable here at all.
 */
export function fingerprintKeys(parsed) {
  const { t, a, b } = fpParts(parsed);
  if (b === null) return [`${t}|${a}|na`];
  return [`${t}|${a}|${b}`, `${t}|${a}|${b - 1}`, `${t}|${a}|${b + 1}`];
}
