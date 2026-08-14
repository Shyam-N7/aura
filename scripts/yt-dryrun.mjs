#!/usr/bin/env node
//
// Measure YouTube-import matching against a real playlist, WITHOUT importing.
//
// Every tuning decision in this feature rests on a measured auto-match rate —
// 4% to 58% across ten rounds — and until now the harness that produced those
// numbers was a scratch file that no longer exists. Nobody could reproduce the
// measurement. That is the gap this closes.
//
//   node --env-file=.env.local scripts/yt-dryrun.mjs "<url>" [--limit N] [--json]
//
// Use the SAME .env.local `npm run server` already uses (package.json:11) — it
// holds the CATALOG_* set. Add YOUTUBE_API_KEY to it (the value you put in
// Vercel) and nothing else is needed. `vercel env pull .env.local` will fetch
// the whole set if you'd rather not copy by hand.
//
// Reads only. It creates no job, writes no database row, and builds no
// playlist — it fetches the tracklist, runs the SERVER'S OWN matching path over
// it, and prints what would have happened.
//
// ── The one rule this script must never break ──
// It calls findCandidates() from ytSearch.js and matchVideo() from ytMatch.js,
// which are the exact functions importJobs.js calls. An earlier version of this
// harness had its own copy of the query-building logic; the server was then
// changed and the harness kept measuring a path production no longer took,
// which is how a reported rate outlived the code that earned it. If you extend
// this file, extend it by calling more of the server, never by reimplementing
// any of it.
//
// Requires the same env the server needs: YOUTUBE_API_KEY for the fetch, and
// the CATALOG_* set for search. No DATABASE_URL — nothing here touches Postgres.

import { parseYouTubeLink } from '../server/youtubeUrl.js';
import { fetchPlaylistForImport, windowForKind } from '../server/youtubeFetch.js';
import { parseVideoVariants } from '../server/ytTrackParse.js';
import { findCandidates } from '../server/ytSearch.js';
import { matchVideo, TIER } from '../server/ytMatch.js';

// Both "--limit=5" and "--limit 5" are accepted, so the separated VALUE has to
// be consumed too — otherwise `--limit 5 <url>` picks "5" as the url.
const argv = process.argv.slice(2);
const asJson = argv.includes('--json');
let limit = null;
const rest = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--json') continue;
  if (a.startsWith('--limit=')) { limit = Number(a.slice('--limit='.length)); continue; }
  if (a === '--limit') { limit = Number(argv[++i]); continue; }
  rest.push(a);
}
const url = rest[0];
if (limit != null && !Number.isFinite(limit)) {
  console.error('--limit needs a number');
  process.exit(2);
}

// PowerShell does not use "\" for line continuation — that is bash. A command
// copied from a bash-style example passes the backslash through as the FIRST
// argument, so it lands here as the url and the real link is never read. It
// surfaced as a raw LinkError stack trace, which tells you nothing about the
// actual mistake.
if (url === '\\' || url === '`') {
  console.error(`"${url}" is a shell line-continuation character, not a url — it was passed as an argument.`);
  console.error('In PowerShell, put the whole command on ONE line:');
  console.error('  node --env-file=.env.local scripts/yt-dryrun.mjs "<url>"');
  process.exit(2);
}

if (!url) {
  console.error('usage: node --env-file=.env.local scripts/yt-dryrun.mjs "<url>" [--limit N] [--json]');
  process.exit(2);
}
if (!process.env.YOUTUBE_API_KEY) {
  console.error('YOUTUBE_API_KEY is not set — this script talks to the real YouTube API.');
  console.error('Load the env the server already uses:');
  console.error('  node --env-file=.env.local scripts/yt-dryrun.mjs "<url>"');
  console.error('and make sure YOUTUBE_API_KEY is in that file alongside the CATALOG_* set.');
  process.exit(2);
}

const pad = (s, n) => String(s ?? '').slice(0, n).padEnd(n);
const pct = (n, d) => (d ? `${((n / d) * 100).toFixed(1)}%` : '—');

// A bad link or an upstream refusal is a USER-FACING outcome here, exactly as it
// is in the app — both carry a .code, and the server already writes a sentence
// for each. Letting them reach the terminal as a stack trace buries the sentence
// under a call stack and makes an ordinary mistake look like a crash.
const die = (err, what) => {
  // Deliberately IGNORES err.expose, which the server sets false on YT_UPSTREAM
  // so an end user never sees upstream detail. That is right for the app and
  // wrong here: the audience for this script is whoever is debugging it, and
  // "YouTube returned an error" without the code is a dead end.
  if (err?.code) console.error(`${err.code}: ${err.message}`);
  else console.error(`${what} failed: ${err?.message ?? err}`);

  // By far the most common cause, and not guessable from the message.
  if (err?.code === 'YT_UPSTREAM') {
    console.error('  Usually the key: check YOUTUBE_API_KEY is valid, that the'
      + ' YouTube Data API v3 is enabled for that project, and that any HTTP-referrer'
      + ' restriction on it does not block a server-side call.');
  }
  if (process.env.DEBUG) console.error(err);
  else console.error('  (set DEBUG=1 for the full error)');
  process.exit(1);
};

let link;
try {
  link = parseYouTubeLink(url);
} catch (err) {
  die(err, 'link parse');
}
console.error(`# ${link.kind} ${link.playlistId} — fetching…`);

let fetched;
try {
  fetched = await fetchPlaylistForImport(link.playlistId, {
    apiKey: process.env.YOUTUBE_API_KEY,
    // Same derivation importJobs.fetchPhase uses. Omitting it does not fall back
    // to a default — it removes the window entirely.
    maxItems: limit ?? windowForKind(link.kind),
  });
} catch (err) {
  die(err, 'youtube fetch');
}
const { videos, meta, windowed, units } = fetched;

// Same filter as fetchPhase: an unavailable video has no title to match on.
const usable = videos.filter(v => !v.unavailable && v.title);
console.error(`# "${meta?.title ?? '?'}" — ${usable.length} usable of ${videos.length}`
  + `${windowed ? ' (windowed)' : ''}, ${units} YouTube units\n`);

const rows = [];
let searches = 0;

for (const v of usable) {
  const readings = parseVideoVariants({
    title: v.title, channelTitle: v.channelTitle, durationSec: v.durationSec, description: '',
  });
  // Wrap the catalogue call only to count it — the function itself is the
  // server's, unmodified.
  const { candidates } = await findCandidates(readings, {
    search: async (...a) => {
      searches++;
      const { searchSongs } = await import('../server/catalog.js');
      return searchSongs(...a);
    },
  });
  const verdict = matchVideo(readings, candidates);
  rows.push({
    ytTitle: v.title,
    // The WINNING reading, not readings[0].
    //
    // "A - B" is song-artist in Indian titles and artist-song in Western ones,
    // so both are scored and the catalogue decides. Printing readings[0] showed
    // the LOSING interpretation whenever the swap won, which made correct
    // matches look broken: "Kurumugil Video Song - Sita Ramam (Tamil)" read as
    // "Sita Ramam (Tamil)" in this column while actually matching Kurumugil at
    // 1.000. Three such rows in one 99-row table were misread as parse failures
    // — a measurement tool that misreports its own input is worse than none.
    readTitle: verdict.best?.parsed?.title ?? readings[0]?.title ?? null,
    readArtist: verdict.best?.parsed?.artists?.[0] ?? readings[0]?.artists?.[0] ?? null,
    readings: readings.length,
    tier: verdict.tier,
    score: verdict.best?.score ?? null,
    match: verdict.best?.candidate
      ? `${verdict.best.candidate.title} — ${verdict.best.candidate.artist}`
      : null,
    candidates: candidates.length,
    // Duration, so the tolerance can be tuned on real deltas instead of a guess.
    // The model discounts duration for a music video (weight 0.1) and is meant
    // to forgive a LONG one — "intros, dialogue and credits routinely add
    // 30-90s" — but its score reaches zero at a 120s difference either way. A
    // "Full Video Song" carrying opening dialogue, a dance sequence and end
    // credits routinely exceeds that, so the most common shape in this catalogue
    // may be scoring maximum evidence AGAINST itself. These columns are how we
    // find out rather than assume.
    videoSec: v.durationSec ?? null,
    trackSec: verdict.best?.candidate?.durationSec ?? null,
    deltaSec: (v.durationSec != null && verdict.best?.candidate?.durationSec != null)
      ? v.durationSec - verdict.best.candidate.durationSec
      : null,
    titleScore: verdict.best?.breakdown?.title ?? null,
    durScore: verdict.best?.breakdown?.duration ?? null,
  });
}

const by = t => rows.filter(r => r.tier === t).length;
const auto = by(TIER.AUTO), review = by(TIER.REVIEW), unmatched = by(TIER.UNMATCHED);
const zero = rows.filter(r => r.candidates === 0).length;

if (asJson) {
  console.log(JSON.stringify({
    playlist: meta?.title, kind: link.kind, windowed,
    total: rows.length, auto, review, unmatched, zeroCandidate: zero,
    youtubeUnits: units, catalogSearches: searches, rows,
  }, null, 2));
} else {
  const sec = n => (n == null ? '   —' : String(n).padStart(4));
  const signed = n => (n == null ? '    —' : (n > 0 ? '+' : '') + n).padStart(5);

  console.log(`${pad('YOUTUBE TITLE', 40)} ${pad('READ AS', 22)} ${pad('TIER', 10)} ${pad('MATCHED', 34)}  SCORE  VID  TRK    Δ    d`);
  console.log('-'.repeat(150));
  for (const r of rows) {
    console.log(
      // The trailing space matters: pad() truncates at the width, so a match
      // string at or over the limit ran straight into the score ("… Prakash
      // K0.963"). Present in every table this harness has printed so far.
      `${pad(r.ytTitle, 40)} ${pad(r.readTitle, 22)} ${pad(r.tier, 10)} ${pad(r.match ?? '—', 34)} `
      + `${r.score == null ? '  —  ' : r.score.toFixed(3)} `
      + `${sec(r.videoSec)} ${sec(r.trackSec)} ${signed(r.deltaSec)} `
      + `${r.durScore == null ? '   —' : r.durScore.toFixed(2)}`,
    );
  }
  console.log('-'.repeat(130));
  console.log(`total ${rows.length}   auto ${auto} (${pct(auto, rows.length)})   `
    + `review ${review} (${pct(review, rows.length)})   unmatched ${unmatched} (${pct(unmatched, rows.length)})`);
  // Zero-candidate is the number that matters most for a non-Latin-script
  // playlist: it is the catalogue's search limit, not the matcher's threshold,
  // and no amount of scoring work moves it.
  // ── Where duration is actually costing us ──────────────────────────────
  //
  // Restricted to rows whose TITLE is already a strong match, because those are
  // the only ones where duration is the deciding evidence rather than a
  // secondary signal. If a row has title >= 0.9 and still is not auto, the
  // question is what stopped it — and this is the answer, per row and in
  // aggregate.
  const strong = rows.filter(r => (r.titleScore ?? 0) >= 0.9 && r.deltaSec != null);
  if (strong.length) {
    const held = strong.filter(r => r.tier !== TIER.AUTO);
    console.log('\nduration, for rows whose title already matches (>= 0.90):');
    const buckets = [
      ['video shorter by >60s', d => d < -60],
      ['       -60s .. -20s  ', d => d >= -60 && d < -20],
      ['       -20s .. +20s  ', d => d >= -20 && d <= 20],
      ['       +20s .. +60s  ', d => d > 20 && d <= 60],
      ['      +60s .. +120s  ', d => d > 60 && d <= 120],
      ['     +120s .. +240s  ', d => d > 120 && d <= 240],
      ['  video longer by >240s', d => d > 240],
    ];
    for (const [label, test] of buckets) {
      const inB = strong.filter(r => test(r.deltaSec));
      if (!inB.length) continue;
      const notAuto = inB.filter(r => r.tier !== TIER.AUTO).length;
      console.log(`  ${label.padEnd(24)} ${String(inB.length).padStart(3)} rows`
        + `   ${String(notAuto).padStart(3)} held out of auto`);
    }
    console.log(`  ${strong.length} strong-title rows, ${held.length} not auto`
      + `${held.length ? ' — deltas: ' + held.map(r => (r.deltaSec > 0 ? '+' : '') + r.deltaSec).join(', ') : ''}`);
  }

  console.log(`\nzero-candidate ${zero} (${pct(zero, rows.length)})   `
    + `youtube units ${units}   catalog searches ${searches}`);
}
