// YouTube playlist import: the queue, the drain, and the reaper.
//
// Structurally this mirrors lyricsJobs.js on purpose — same atomic-claim idiom,
// same "cron recovers what the request path dropped" shape — because that
// arrangement is already proven against this deployment's constraints and a
// second, different queue design would be two things to reason about.
//
// EVERYTHING is gated on youtubeImportEnabled(). With YOUTUBE_API_KEY unset no
// job is ever created, no drain does work, and the cron step returns
// immediately, so the app behaves exactly as it did before this feature existed.
//
// Job state machine (yt_import_jobs.status):
//   queued ──drain──▶ fetching ──▶ matching ──▶ ready ──all reviewed──▶ complete
//                         │                        │
//                         └────────▶ failed ◀──────┘   (terminal)
//
// 'ready' means the playlist EXISTS and holds the auto-matched tracks. Review is
// what moves 'ready' to 'complete', and a user who never returns leaves a
// perfectly good playlist behind — the deliberate product choice, so nobody has
// to finish a 12-decision screen before hearing anything.
//
// ── Why the work is resumable rather than done in one request ──
// A serverless invocation is capped at 60s (vercel.json). A cold 30-track import
// is ~30 catalog searches at ~400ms, so it USUALLY finishes in one drain — but
// "usually" is not a design. Every drain takes a time budget, stops cleanly when
// it runs out, and leaves yt_import_items rows in 'pending' as the cursor. The
// next tick — a client poll, or the daily cron — resumes exactly there.
//
// ── The budget that actually binds ──
// YouTube quota is NOT the constraint. A 30-track import costs ~3 units
// (1 playlists.list + 1 playlistItems page + 1 videos page) against a default
// 10,000/day, i.e. thousands of imports. The scarce resource is CATALOG
// searches, which is why RADIO_WINDOW is 30 rather than 50, why ytSearch caps at
// two searches per video, and why yt_match_cache exists at all.

import { pool, query } from './db.js';
import {
  YOUTUBE_API_KEY, YT_IMPORT_DAILY_CAP, YT_IMPORT_USER_DAILY,
} from './config.js';
import { parseYouTubeLink, STRATEGY } from './youtubeUrl.js';
import { fetchPlaylistForImport, fetchPlaylistMeta, windowForKind, YouTubeError } from './youtubeFetch.js';
import { parseVideoVariants, parseVideo } from './ytTrackParse.js';
import { matchVideo, fingerprint, fingerprintKeys, TIER, THRESHOLDS } from './ytMatch.js';
import { findCandidates } from './ytSearch.js';
import { cacheTracks, getTrackById } from './tracks.js';
import { createPlaylistFromImport, appendTracksToPlaylist } from './playlists.js';
import { getUserLanguages } from './context.js';

export const STATUS = {
  QUEUED: 'queued',
  FETCHING: 'fetching',
  MATCHING: 'matching',
  READY: 'ready',
  COMPLETE: 'complete',
  FAILED: 'failed',
};

// yt_import_items.state, for reference — these live as literals inside the SQL
// below rather than as a constant, because a JS constant cannot be interpolated
// into a query string without inviting exactly the habit we don't want here:
//   pending  — not yet resolved by the drain, OR resolved to 'review' and now
//              waiting on the user. countPending distinguishes the two by
//              `tier IS NULL`.
//   done     — auto-matched, already in the playlist.
//   accepted — the user picked a candidate on the review screen.
//   skipped  — the user declined it.

const DAY_MS = 24 * 60 * 60 * 1000;
// YouTube's terms cap storage of YouTube data at 30 days. This is the number the
// prune enforces; see the v32 migration for why only yt_import_items is subject.
const RETENTION_MS = 30 * DAY_MS;
// A job left mid-drain by a killed invocation. Generous, because a legitimately
// slow drain must never be reaped out from under itself — the cost of waiting is
// a delayed import, the cost of reaping early is duplicated catalog searches.
const STUCK_MS = 10 * 60 * 1000;
// Default per-drain time budget. Comfortably inside the 60s function ceiling
// with room for the response itself and for one item to overrun.
const DEFAULT_BUDGET_MS = 45_000;

export function youtubeImportEnabled() {
  return !!YOUTUBE_API_KEY;
}

function disabled() {
  const err = new Error('playlist import is not available right now');
  err.statusCode = 503;
  err.expose = true;
  err.code = 'YT_DISABLED';
  return err;
}

function newJobId() {
  return 'yti_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

// ── Enqueue ─────────────────────────────────────────────────────────

/**
 * Validate a pasted link and create a job. Does NOT touch the YouTube API —
 * parseYouTubeLink classifies from the id alone, which is the whole reason it
 * exists: WL and HL return an EMPTY LIST rather than an error, so a link we
 * cannot serve would otherwise look like a successful import of nothing.
 */
export async function enqueueImport(userId, url) {
  if (!youtubeImportEnabled()) throw disabled();

  const link = parseYouTubeLink(url);   // throws LinkError (422) with a specific code

  if (link.strategy === STRATEGY.OAUTH) {
    const err = new Error('that playlist is private to your YouTube account — make it unlisted or public, then paste it again');
    err.statusCode = 422; err.expose = true; err.code = 'YT_OAUTH_REQUIRED';
    throw err;
  }
  if (link.strategy === STRATEGY.GUIDED) {
    // A user-seeded mix (RDMM/RDAMVM…). Whether a server key can read these is
    // the one untested row in the routing table, so we do not pretend: the
    // client turns this code into "open it in YouTube and save it as a
    // playlist first", which always works.
    const err = new Error("that's a mix YouTube built for your account — open it in YouTube, save it as a playlist, then paste that link");
    err.statusCode = 422; err.expose = true; err.code = 'YT_NEEDS_SAVE';
    throw err;
  }
  if (link.strategy !== STRATEGY.OFFICIAL) {
    const err = new Error("we don't recognise that kind of YouTube playlist");
    err.statusCode = 422; err.expose = true; err.code = 'YT_UNSUPPORTED';
    throw err;
  }

  await assertUnderCaps(userId);

  // An import already running for this exact playlist is returned rather than
  // duplicated — double-tapping "import" is not a request for two playlists.
  const existing = await query(
    `SELECT id, status FROM yt_import_jobs
      WHERE user_id = $1 AND yt_playlist_id = $2
        AND status IN ('queued','fetching','matching')
      ORDER BY created_at DESC LIMIT 1`,
    [userId, link.playlistId],
  );
  if (existing.rows.length) return { ...existing.rows[0], reused: true };

  const id = newJobId();
  const ts = Date.now();
  await pool.query(
    `INSERT INTO yt_import_jobs (id, user_id, yt_playlist_id, kind, strategy, status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, 'queued', $6, $6)`,
    [id, userId, link.playlistId, link.kind, link.strategy, ts],
  );
  return { id, status: STATUS.QUEUED, kind: link.kind, reused: false };
}

// Both caps count STARTED imports in the last 24h. Soft — a race can let one
// extra through, which is the right trade for not serializing every enqueue.
async function assertUnderCaps(userId) {
  const since = Date.now() - DAY_MS;
  const { rows } = await query(
    `SELECT
       COUNT(*) FILTER (WHERE user_id = $1)::int AS mine,
       COUNT(*)::int                             AS total
     FROM yt_import_jobs WHERE created_at > $2`,
    [userId, since],
  );
  const { mine = 0, total = 0 } = rows[0] ?? {};
  if (mine >= YT_IMPORT_USER_DAILY) {
    const err = new Error("that's a lot of importing for one day — try again tomorrow");
    err.statusCode = 429; err.expose = true; err.code = 'YT_USER_CAP';
    throw err;
  }
  if (total >= YT_IMPORT_DAILY_CAP) {
    const err = new Error('imports are busy right now — try again in a little while');
    err.statusCode = 503; err.expose = true; err.code = 'YT_GLOBAL_CAP';
    throw err;
  }
}

// ── Drain ───────────────────────────────────────────────────────────

/**
 * Take a LEASE on a job for this drain. ONE statement, so two concurrent drains
 * (a client poll and the cron, say) cannot both take the same job and pay for
 * the same catalog searches twice. Same atomic-claim trick as
 * lyricsJobs.dispatchJob.
 *
 * Claimable = any non-terminal job whose lease has expired or was released.
 * The lease — NOT updated_at — is what serializes drains; see the column comment
 * in the v32 migration for why conflating the two breaks resumption.
 */
async function claimJob(jobId, now) {
  const { rows } = await pool.query(
    `UPDATE yt_import_jobs
        SET status = CASE WHEN status = 'queued' THEN 'fetching' ELSE status END,
            leased_until = $2,
            updated_at = $3
      WHERE id = $1
        AND status IN ('queued','fetching','matching')
        AND leased_until < $3
      RETURNING id, user_id, yt_playlist_id, kind, status, title, windowed, playlist_id`,
    [jobId, now + STUCK_MS, now],
  );
  return rows[0] ?? null;
}

// Hand the job back so the next tick can pick it up straight away. Called on
// every exit from a drain that leaves work behind — without it the job would
// wait out the full lease for no reason.
async function releaseJob(jobId) {
  await pool.query(
    `UPDATE yt_import_jobs SET leased_until = 0, updated_at = $2 WHERE id = $1`,
    [jobId, Date.now()],
  );
}

// Extend the lease during a long but healthy drain, so it is never reaped out
// from under itself.
async function touch(jobId) {
  await pool.query(
    `UPDATE yt_import_jobs SET leased_until = $2, updated_at = $3 WHERE id = $1`,
    [jobId, Date.now() + STUCK_MS, Date.now()],
  );
}

async function failJob(jobId, code, message) {
  await pool.query(
    `UPDATE yt_import_jobs SET status='failed', error=$2, updated_at=$3 WHERE id=$1`,
    [jobId, `${code}: ${String(message).slice(0, 400)}`, Date.now()],
  );
}

/**
 * Advance one job as far as the time budget allows.
 *
 * Returns { status, done, remaining } — `done` is how many items this tick
 * resolved, which is what lets a caller decide whether to poll again soon or
 * back off.
 *
 * Never throws for an expected failure (private playlist, quota, unreachable):
 * those settle the job as 'failed' with a client-safe code and resolve normally,
 * because a 500 from a poll is not information the client can use.
 */
export async function drainJob(jobId, { budgetMs = DEFAULT_BUDGET_MS, fetchOpts, search } = {}) {
  if (!youtubeImportEnabled()) return { status: STATUS.FAILED, done: 0, remaining: 0 };

  const deadline = Date.now() + budgetMs;
  const job = await claimJob(jobId, Date.now());
  if (!job) {
    // Not ours: either another drain holds it, or it is already terminal.
    const { rows } = await query(`SELECT status FROM yt_import_jobs WHERE id = $1`, [jobId]);
    return { status: rows[0]?.status ?? null, done: 0, remaining: 0, claimed: false };
  }

  try {
    if (job.status === STATUS.FETCHING || job.status === STATUS.QUEUED) {
      await fetchPhase(job, fetchOpts);
    }
    return await matchPhase(job, deadline, search);
  } catch (err) {
    if (err instanceof YouTubeError) {
      await failJob(jobId, err.code, err.message);
      return { status: STATUS.FAILED, done: 0, remaining: 0, code: err.code, message: err.message };
    }
    await failJob(jobId, 'YT_INTERNAL', err?.message ?? 'unknown');
    return { status: STATUS.FAILED, done: 0, remaining: 0, code: 'YT_INTERNAL' };
  }
}

/** YouTube side: fetch the tracklist once and write the item rows. */
async function fetchPhase(job, fetchOpts) {
  const result = await fetchPlaylistForImport(job.yt_playlist_id, {
    apiKey: YOUTUBE_API_KEY,
    // The window MUST be derived here. fetchPlaylistItems takes maxItems from
    // opts and fetchPlaylistForImport does not compute one, so omitting this
    // does not fall back to a default — it removes the window entirely, and an
    // RD mix (which is effectively infinite) paginates to MAX_ITEMS and dies on
    // YT_TOO_LARGE. That is the exact failure RADIO_WINDOW exists to prevent,
    // so the kind-to-window decision follows classification, as windowForKind's
    // own contract asks.
    maxItems: windowForKind(job.kind),
    ...fetchOpts,
  });

  // Unavailable entries (deleted/private videos) are dropped here rather than
  // carried as permanently-unmatchable rows: there is no title to match on, so
  // they would be pure noise on the review screen. The count difference is
  // surfaced instead, because "27 of 30" needs an explanation.
  const usable = result.videos.filter(v => !v.unavailable && v.title);

  const ts = Date.now();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Re-entrant by construction: a fetch phase that ran before dying leaves
    // rows behind, and ON CONFLICT keeps this idempotent rather than doubling
    // the playlist. (job_id, position) is the natural key for exactly this.
    for (const v of usable) {
      await client.query(
        `INSERT INTO yt_import_items (job_id, position, video_id, yt_title, yt_channel, yt_duration, state)
         VALUES ($1,$2,$3,$4,$5,$6,'pending')
         ON CONFLICT (job_id, position) DO NOTHING`,
        [job.id, v.position, v.videoId, v.title, v.channelTitle, v.durationSec],
      );
    }
    await client.query(
      `UPDATE yt_import_jobs
          SET status='matching', title=$2, windowed=$3, total_count=$4,
              fetched_count=$5, units_spent = units_spent + $6, updated_at=$7
        WHERE id=$1`,
      [job.id, result.meta?.title ?? null, !!result.windowed, usable.length,
       result.videos.length, result.units ?? 0, ts],
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  if (usable.length === 0) {
    // A playlist that exists but yields nothing we can work with. Distinct from
    // a failure — the link was fine, there is just nothing in it for us.
    await pool.query(
      `UPDATE yt_import_jobs SET status='ready', updated_at=$2 WHERE id=$1`,
      [job.id, Date.now()],
    );
  }
}

/** Catalog side: resolve pending items until the budget runs out. */
async function matchPhase(job, deadline, search) {
  let done = 0;

  // Resolved ONCE per drain rather than per item: it is two queries, it cannot
  // change mid-drain, and a 30-track import would otherwise pay for it thirty
  // times. Never throws — an unknown listener is [], which the matcher reads as
  // "no opinion" and leaves the ranking exactly as it was.
  const userLangs = await getUserLanguages(job.user_id).catch(() => []);

  for (;;) {
    if (Date.now() >= deadline) {
      // Out of time, not out of work. Release the lease so the very next tick —
      // the client's next poll — resumes instead of waiting out the lease.
      await releaseJob(job.id);
      const remaining = await countPending(job.id);
      return { status: STATUS.MATCHING, done, remaining, budgetExhausted: true };
    }

    const { rows } = await query(
      `SELECT id, position, video_id, yt_title, yt_channel, yt_duration
         FROM yt_import_items
        WHERE job_id = $1 AND state = 'pending' AND tier IS NULL
        ORDER BY position ASC LIMIT 1`,
      [job.id],
    );
    const item = rows[0];
    if (!item) break;

    await resolveItem(job, item, search, userLangs);
    done++;
    // Keep updated_at moving so a long but healthy drain is never mistaken for
    // a dead one by claimJob's STUCK_MS check.
    if (done % 5 === 0) await touch(job.id);
  }

  const summary = await finishJob(job);
  return { status: summary.status, done, remaining: 0, ...summary };
}

async function countPending(jobId) {
  const { rows } = await query(
    `SELECT COUNT(*)::int AS n FROM yt_import_items WHERE job_id=$1 AND state='pending' AND tier IS NULL`,
    [jobId],
  );
  return rows[0]?.n ?? 0;
}

/** One video: cache lookup, else search + score. Writes the verdict. */
async function resolveItem(job, item, search, userLangs = []) {
  const variants = parseVideoVariants({
    title: item.yt_title,
    channelTitle: item.yt_channel,
    durationSec: item.yt_duration,
    description: '',   // pruned/not stored per item — see the retention note
  });
  const readings = Array.isArray(variants) ? variants : [variants];
  const primary = readings[0];
  const fp = primary ? fingerprint(primary) : null;

  // 1. Cache. A hit costs one indexed read and skips the catalog entirely —
  //    this is what makes re-imports and refreshes nearly free.
  //
  //    Only a CONFIDENT hit short-circuits. A cached entry that would land in
  //    review is deliberately ignored, because a cache row stores the winner
  //    and not the alternatives: honouring it would put an item on the review
  //    screen with nothing to choose from, which is a dead end rather than a
  //    decision. Falling through costs one search and produces a real choice.
  //    (Found by driving the HTTP surface, where a review item came back with
  //    an empty candidates array.)
  const cached = fp ? await lookupCache(readings) : null;
  let confident = cached && (cached.user_confirmed || cached.score >= THRESHOLDS.auto);

  // The escape hatch for a poisoned row. A wrong AUTO seeds this cache at or
  // above the auto threshold, and this short-circuit then replays it on every
  // future import BEFORE search or scoring run — so the language tiebreak in
  // matchVideo, written for exactly that mistake, is unreachable for exactly
  // the rows that need it. A wrong auto also never reaches the review screen,
  // and review acceptance is the only writer that outranks a cached score.
  //
  // So: a confident hit that is NOT human-confirmed, whose track's language is
  // known and OUTSIDE the listener's languages, falls through to a real
  // search — ONCE per row, ever, recorded in lang_checked_at. Once-ever is
  // load-bearing, not an optimisation: without it a correct-but-out-of-
  // affinity playlist (an english list for a tamil-affinity listener) would
  // pay a full re-search on every refresh forever, and a fall-through that
  // lands in REVIEW (which writes nothing back) would loop the same review
  // card at the user for the rest of time. Unknown language or an empty
  // userLangs means "no opinion" and changes nothing — a fresh account's
  // first import is the worst possible place to start second-guessing.
  let fellThroughFrom = null;
  if (confident && cached && !cached.user_confirmed && cached.lang_checked_at == null) {
    const lang = String(cached.track_language ?? '').trim().toLowerCase();
    if (lang && userLangs.length && !userLangs.includes(lang)) {
      await pool.query(
        `UPDATE yt_match_cache SET lang_checked_at = $2 WHERE fingerprint = $1`,
        [cached.fingerprint, Date.now()],
      );
      fellThroughFrom = cached.fingerprint;
      confident = false;
    }
  }

  if (confident) {
    await writeVerdict(item.id, {
      fingerprint: fp,
      // A human-confirmed pairing is auto regardless of what it once scored —
      // that is the whole point of recording the confirmation.
      tier: TIER.AUTO,
      trackId: cached.track_id,
      score: cached.score,
      candidates: null,
    });
    await pool.query(
      `UPDATE yt_match_cache SET hits = hits + 1, updated_at = $2 WHERE fingerprint = $1`,
      [cached.fingerprint, Date.now()],
    );
    return;
  }

  // 2. Catalog.
  const { candidates } = await findCandidates(readings, { search });
  const verdict = matchVideo(readings, candidates, { userLangs });

  // Cache the tracks we are about to reference so the playlist renders without
  // a per-track upstream fetch when the user opens it.
  const referenced = [verdict.best?.candidate, ...(verdict.candidates ?? []).map(c => c.candidate)]
    .filter(Boolean);
  if (referenced.length) await cacheTracks(referenced);

  await writeVerdict(item.id, {
    fingerprint: fp,
    tier: verdict.tier,
    trackId: verdict.tier === TIER.UNMATCHED ? null : verdict.best?.candidate?.id ?? null,
    score: verdict.best?.score ?? null,
    // Review needs the alternatives AND why the winner won; unmatched needs
    // nothing, and storing candidates for it would just be dead JSON.
    candidates: verdict.tier === TIER.UNMATCHED ? null : summariseCandidates(verdict),
  });

  // Only AUTO seeds the cache. A review-tier guess is exactly the thing we do
  // not want to make permanent behind the user's back — if they confirm it on
  // the review screen, THAT writes the cache entry, with user_confirmed set.
  if (fp && verdict.tier === TIER.AUTO && verdict.best?.candidate?.id) {
    await upsertCache(fp, verdict.best.candidate.id, verdict.best.score, false);
    // A language fall-through may have HIT a neighbour-bucket or rival-reading
    // key while the write above lands only on the primary. Without correcting
    // the row we actually hit, the poisoned entry survives and outranks the
    // correction on score at the very next lookup — a search paid to fix
    // nothing.
    if (fellThroughFrom && fellThroughFrom !== fp) {
      await upsertCache(fellThroughFrom, verdict.best.candidate.id, verdict.best.score, false);
    }
  }
}

function summariseCandidates(verdict) {
  return (verdict.candidates ?? []).slice(0, 3).map(c => ({
    id: c.candidate?.id,
    title: c.candidate?.title,
    artist: c.candidate?.artist,
    album: c.candidate?.album,
    imageUrl: c.candidate?.imageUrl ?? null,
    durationSec: c.candidate?.durationSec ?? null,
    // Without this, two rows for the same song in different languages render
    // identically — same title, same (usually unknown) artist, similar length —
    // and the review screen asks a question it has not given the user enough to
    // answer. It is also the field the tiebreak in ytMatch reasons about, so
    // showing it is showing the actual reason this row is here.
    language: c.candidate?.language ?? null,
    score: c.score,
    breakdown: c.breakdown,
    // The reading that produced this score. "A - B" is song-artist in Indian
    // titles and artist-song in Western ones, and showing which one won is what
    // makes a review decision explicable rather than arbitrary.
    reading: c.parsed ? { title: c.parsed.title, artists: c.parsed.artists } : null,
  }));
}

async function lookupCache(readings) {
  // fingerprintKeys returns the exact key plus its duration neighbours, in
  // priority order — two encodes of one song land in adjacent buckets, so an
  // exact-key lookup alone misses them. A miss costs one search, never a wrong
  // match, which is why approximate keys are acceptable at all.
  const keys = [...new Set(readings.flatMap(r => fingerprintKeys(r)))];
  if (!keys.length) return null;
  // The track's language rides along via a LEFT JOIN — deliberately NOT
  // getTrackById, whose DB-miss path is a live upstream fetch (the phantom-id
  // amplification hazard app.js documents on the play-count route). A row
  // whose track never landed locally simply reads language NULL, which the
  // gate below treats as unknown.
  const { rows } = await query(
    `SELECT c.fingerprint, c.track_id, c.score, c.user_confirmed,
            c.lang_checked_at, t.language AS track_language
       FROM yt_match_cache c
       LEFT JOIN tracks t ON t.id = c.track_id
      WHERE c.fingerprint = ANY($1)
      ORDER BY c.user_confirmed DESC, c.score DESC NULLS LAST
      LIMIT 1`,
    [keys],
  );
  return rows[0] ?? null;
}

export async function upsertCache(fp, trackId, score, userConfirmed) {
  const ts = Date.now();
  await pool.query(
    `INSERT INTO yt_match_cache (fingerprint, track_id, score, user_confirmed, hits, created_at, updated_at)
     VALUES ($1,$2,$3,$4,0,$5,$5)
     ON CONFLICT (fingerprint) DO UPDATE SET
       track_id       = EXCLUDED.track_id,
       score          = EXCLUDED.score,
       -- A human decision is sticky: once confirmed, a later heuristic pass
       -- must not quietly demote it back to a guess.
       user_confirmed = yt_match_cache.user_confirmed OR EXCLUDED.user_confirmed,
       updated_at     = EXCLUDED.updated_at`,
    [fp, trackId, score, !!userConfirmed, ts],
  );
}

async function writeVerdict(itemId, { fingerprint: fp, tier, trackId, score, candidates }) {
  // Only REVIEW leaves an item pending. 'auto' is already in the playlist, and
  // 'unmatched' has no candidates, so there is no decision for the user to make
  // — leaving it pending would mean a job could never reach 'complete' and the
  // progress count would report work that does not exist. Unmatched rows are
  // still returned by getJob and still shown, as "couldn't find this one".
  await pool.query(
    `UPDATE yt_import_items
        SET fingerprint=$2, tier=$3, track_id=$4, score=$5, candidates=$6,
            state = CASE WHEN $3 = 'review' THEN 'pending' ELSE 'done' END
      WHERE id=$1`,
    [itemId, fp, tier, trackId, score, candidates ? JSON.stringify(candidates) : null],
  );
}

// YouTube names a mix after the video you started it from, so its title comes
// back as "Mix - <that video's full title>" — and a label's video title is a
// credit block, not a name. The first live import produced:
//
//   Mix - Master - Andha Kanna Paathaakaa Lyric | Thalapathy Vijay |
//   Anirudh Ravichander | Lokesh Kanagaraj
//
// 103 characters, most of it cast list. Nobody wants that in their library.
//
// The clean name is already sitting in the result: the first auto-matched track
// carries the CATALOGUE's own title for that song, which is canonical, short,
// and — unlike anything we could parse out of the YouTube string — already
// verified to exist. Parsing the YouTube title is only the fallback, for a mix
// whose first video didn't auto-match.
//
// A finite playlist keeps its own name untouched: a human named that one, and
// it is not ours to improve.
const MIX_PREFIX = /^\s*mix\s*[-–—:]\s*/i;
const MIX_NAME_MAX = 60;

export async function playlistNameFor({ title, windowed, seedTrackId }) {
  const raw = String(title ?? '').trim();
  if (!windowed) return raw || 'Imported from YouTube';

  // The catalogue's title for the first song we matched.
  if (seedTrackId) {
    const seed = await getTrackById(seedTrackId).catch(() => null);
    const name = seed?.title?.trim();
    if (name) return `Mix - ${name}`.slice(0, MIX_NAME_MAX);
  }

  if (!raw) return 'Imported from YouTube';

  // Fallback: run the same parser the matcher uses over the seed video's title,
  // so at least the cast list and the decoration come off.
  const seedTitle = raw.replace(MIX_PREFIX, '');
  const parsed = parseVideo({ title: seedTitle, channelTitle: '', durationSec: null, description: '' });
  const cleaned = parsed?.title?.trim();
  if (cleaned) return `Mix - ${cleaned}`.slice(0, MIX_NAME_MAX);
  return raw.slice(0, MIX_NAME_MAX);
}

/**
 * Every item resolved: create the playlist with the auto-matched tracks and
 * move to 'ready'. Review items stay 'pending' — they are the user's queue now,
 * not the drain's.
 */
async function finishJob(job) {
  const { rows: counts } = await query(
    `SELECT tier, COUNT(*)::int AS n FROM yt_import_items WHERE job_id=$1 GROUP BY tier`,
    [job.id],
  );
  const by = Object.fromEntries(counts.map(r => [r.tier, r.n]));
  const auto = by[TIER.AUTO] ?? 0;
  const review = by[TIER.REVIEW] ?? 0;
  const unmatched = by[TIER.UNMATCHED] ?? 0;

  const { rows: autoRows } = await query(
    `SELECT track_id FROM yt_import_items
      WHERE job_id=$1 AND tier='auto' AND track_id IS NOT NULL
      ORDER BY position ASC`,
    [job.id],
  );
  const trackIds = autoRows.map(r => r.track_id);

  const { rows: j } = await query(`SELECT title, windowed, fetched_count FROM yt_import_jobs WHERE id=$1`, [job.id]);
  const windowed = !!j[0]?.windowed;

  let playlistId = job.playlist_id;
  if (!playlistId) {
    const created = await createPlaylistFromImport(job.user_id, {
      name: await playlistNameFor({ title: j[0]?.title, windowed, seedTrackId: trackIds[0] }),
      description: windowed
        ? 'Imported from a YouTube mix — a snapshot of the first tracks, not a live sync.'
        : 'Imported from YouTube.',
      trackIds,
    });
    playlistId = created.id;
  } else if (trackIds.length) {
    // Either a REFRESH writing into the playlist it already owns, or re-entry
    // after a crash between playlist creation and the counts update. Both are
    // the same operation, and it is idempotent: appendTracksToPlaylist absorbs
    // tracks already present.
    await appendTracksToPlaylist(job.user_id, playlistId, trackIds);
  }

  // Remember the source so this playlist can be refreshed later — but ONLY for
  // a finite one. A windowed mix regenerates on every fetch (measured twice:
  // the same link returned Kannada film music one run and KATSEYE the next), so
  // there is no stable source to diff against and "refresh" would promise a
  // sync that cannot exist. Absence of a link row is what hides the button.
  if (!windowed) {
    await pool.query(
      `INSERT INTO yt_playlist_links (playlist_id, yt_playlist_id, kind, last_item_count, last_synced_at, created_at)
       VALUES ($1,$2,$3,$4,$5,$5)
       ON CONFLICT (playlist_id) DO UPDATE SET
         last_item_count = EXCLUDED.last_item_count,
         last_synced_at  = EXCLUDED.last_synced_at`,
      // The RAW fetched count, not auto+review+unmatched: the refresh guard
      // compares this against YouTube's raw itemCount, and the usable count is
      // smaller whenever the playlist holds a deleted/private video — which
      // made every such playlist read as "changed" on every refresh, forever.
      [playlistId, job.yt_playlist_id, job.kind,
       j[0]?.fetched_count ?? auto + review + unmatched, Date.now()],
    ).catch((e) => console.warn('[yt-import] link write failed:', e?.message ?? e));
  }

  const status = review > 0 ? STATUS.READY : STATUS.COMPLETE;
  await pool.query(
    `UPDATE yt_import_jobs
        SET status=$2, playlist_id=$3, auto_count=$4, review_count=$5, unmatched_count=$6, updated_at=$7
      WHERE id=$1`,
    [job.id, status, playlistId, auto, review, unmatched, Date.now()],
  );
  return { status, playlistId, auto, review, unmatched };
}

// ── Review resolution ───────────────────────────────────────────────

/**
 * The user's verdict on one review item: accept a candidate, or skip it.
 *
 * An acceptance writes the pairing into yt_match_cache with user_confirmed —
 * the mechanism by which real corrections outrank the heuristic on every future
 * import, for every user. That is the feature's only route to improving after
 * release, so it matters more than it looks.
 */
export async function resolveReviewItem(userId, jobId, itemId, { trackId, skip = false } = {}) {
  const { rows } = await query(
    `SELECT i.id, i.fingerprint, i.candidates, j.playlist_id, j.user_id
       FROM yt_import_items i JOIN yt_import_jobs j ON j.id = i.job_id
      WHERE i.id = $1 AND i.job_id = $2`,
    [itemId, jobId],
  );
  const row = rows[0];
  if (!row || row.user_id !== userId) {
    const err = new Error('not found');
    err.statusCode = 404;
    throw err;
  }

  if (skip || !trackId) {
    await pool.query(`UPDATE yt_import_items SET state='skipped' WHERE id=$1`, [itemId]);
    return await refreshJobProgress(jobId);
  }

  // The chosen id must be one WE offered. Without this the endpoint is an
  // arbitrary "add any track to this playlist" primitive reachable with a
  // job id — a quieter authorization hole than it first appears, since the
  // playlist write below runs as the job's owner.
  const offered = (row.candidates ?? []).some(c => c?.id === trackId);
  if (!offered) {
    const err = new Error('that suggestion is no longer available');
    err.statusCode = 422; err.expose = true; err.code = 'YT_NOT_OFFERED';
    throw err;
  }

  if (row.playlist_id) await appendTracksToPlaylist(userId, row.playlist_id, [trackId]);
  await pool.query(
    `UPDATE yt_import_items SET state='accepted', track_id=$2 WHERE id=$1`,
    [itemId, trackId],
  );
  if (row.fingerprint) {
    const chosen = (row.candidates ?? []).find(c => c?.id === trackId);
    await upsertCache(row.fingerprint, trackId, chosen?.score ?? null, true);
  }
  return await refreshJobProgress(jobId);
}

// A job is 'complete' once nothing is left pending. Recomputed rather than
// decremented so a double-submitted resolve can't drive the counter negative.
async function refreshJobProgress(jobId) {
  const { rows } = await query(
    `SELECT COUNT(*) FILTER (WHERE state='pending')::int AS pending,
            COUNT(*) FILTER (WHERE state='accepted')::int AS accepted
       FROM yt_import_items WHERE job_id=$1`,
    [jobId],
  );
  const pending = rows[0]?.pending ?? 0;
  if (pending === 0) {
    await pool.query(
      `UPDATE yt_import_jobs SET status='complete', updated_at=$2 WHERE id=$1 AND status='ready'`,
      [jobId, Date.now()],
    );
  }
  return { pending, accepted: rows[0]?.accepted ?? 0 };
}

// ── Refresh ─────────────────────────────────────────────────────────

/** The YouTube sources this user's playlists were imported from. */
export async function listLinks(userId) {
  const { rows } = await query(
    `SELECT l.playlist_id, l.yt_playlist_id, l.kind, l.last_item_count, l.last_synced_at
       FROM yt_playlist_links l JOIN playlists p ON p.id = l.playlist_id
      WHERE p.user_id = $1`,
    [userId],
  );
  return rows;
}

/**
 * Check whether a linked playlist changed on YouTube, and import what is new.
 *
 * The cheap check first: playlists.list returns itemCount for ONE unit. An
 * unchanged count ends it there, which is what makes a refresh button safe to
 * offer at all — the common answer is "nothing new" and it should cost nothing.
 *
 * ── The part worth explaining ──
 * There is no diff. The obvious design compares stored video ids against the
 * new list, but the 30-day retention rule deletes those ids, so past a month
 * there is nothing to compare against and the diff needs a special case.
 *
 * Re-matching the whole playlist instead removes the special case AND is nearly
 * free: every fingerprint from the first import is already in yt_match_cache,
 * so a re-run costs ~3 YouTube units and almost no catalog searches, and the
 * append is idempotent. Delta and full-rebuild converge on the same operation,
 * which is a better outcome than making them agree.
 */
export async function refreshPlaylist(userId, playlistId, { fetchOpts } = {}) {
  if (!youtubeImportEnabled()) throw disabled();

  const { rows } = await query(
    `SELECT l.yt_playlist_id, l.kind, l.last_item_count
       FROM yt_playlist_links l JOIN playlists p ON p.id = l.playlist_id
      WHERE l.playlist_id = $1 AND p.user_id = $2`,
    [playlistId, userId],
  );
  const link = rows[0];
  if (!link) {
    const err = new Error('that playlist did not come from YouTube');
    err.statusCode = 404; err.expose = true; err.code = 'YT_NO_LINK';
    throw err;
  }

  const meta = await fetchPlaylistMeta(link.yt_playlist_id, {
    apiKey: YOUTUBE_API_KEY,
    ...fetchOpts,
  });

  if (meta.itemCount != null && meta.itemCount === link.last_item_count) {
    await pool.query(
      `UPDATE yt_playlist_links SET last_synced_at=$2 WHERE playlist_id=$1`,
      [playlistId, Date.now()],
    );
    return { changed: false, jobId: null };
  }

  await assertUnderCaps(userId);

  // The job is bound to the EXISTING playlist, so finishJob appends instead of
  // creating a second one.
  const id = newJobId();
  const ts = Date.now();
  await pool.query(
    `INSERT INTO yt_import_jobs
       (id, user_id, yt_playlist_id, kind, strategy, status, playlist_id, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,'queued',$6,$7,$7)`,
    [id, userId, link.yt_playlist_id, link.kind, STRATEGY.OFFICIAL, playlistId, ts],
  );
  return { changed: true, jobId: id, itemCount: meta.itemCount };
}

// ── Cron ────────────────────────────────────────────────────────────

/**
 * Recover jobs whose invocation died, drain what is waiting, and enforce the
 * 30-day YouTube-data retention rule.
 *
 * The prune runs even when the feature is disabled — turning the key off must
 * not strand YouTube-derived rows past their retention window.
 */
export async function processImportQueue({ batch = 5, budgetMs = 20_000 } = {}) {
  const pruned = await pruneExpired();
  if (!youtubeImportEnabled()) return { drained: 0, pruned, enabled: false };

  const now = Date.now();
  // Unleased, non-terminal jobs: freshly queued ones, ones a drain released
  // when its budget ran out, and ones whose invocation died and whose lease has
  // since expired. All three are the same condition, which is the point of
  // having a lease column at all.
  const { rows } = await query(
    `SELECT id FROM yt_import_jobs
      WHERE status IN ('queued','fetching','matching') AND leased_until < $1
      ORDER BY updated_at ASC LIMIT $2`,
    [now, batch],
  );

  let drained = 0;
  const perJob = Math.max(5_000, Math.floor(budgetMs / Math.max(rows.length, 1)));
  for (const r of rows) {
    try {
      await drainJob(r.id, { budgetMs: perJob });
      drained++;
    } catch (err) {
      console.warn('[yt-import] drain failed:', r.id, err?.message ?? err);
    }
  }
  return { drained, pruned, enabled: true };
}

/**
 * Delete YouTube-derived rows past the 30-day retention window.
 *
 * Items only. yt_match_cache is keyed on a fingerprint of our own derived parse
 * rather than on any YouTube identifier, so it is outside the rule and must
 * survive — it is the matcher's accumulated memory, and expiring it monthly
 * would throw away the one asset that improves with use.
 */
export async function pruneExpired() {
  const cutoff = Date.now() - RETENTION_MS;
  const { rowCount } = await pool.query(
    `DELETE FROM yt_import_items
      WHERE job_id IN (SELECT id FROM yt_import_jobs WHERE created_at < $1)`,
    [cutoff],
  );
  // Terminal jobs older than the window carry nothing but counts at this point;
  // drop them too so the table does not grow without bound.
  await pool.query(
    `DELETE FROM yt_import_jobs
      WHERE created_at < $1 AND status IN ('complete','failed','ready')`,
    [cutoff],
  ).catch(() => {});
  return rowCount;
}

// ── Reads for the API ───────────────────────────────────────────────

export async function getJob(userId, jobId) {
  const { rows } = await query(
    `SELECT id, yt_playlist_id, kind, status, title, windowed, playlist_id,
            total_count, auto_count, review_count, unmatched_count, error,
            created_at, updated_at
       FROM yt_import_jobs WHERE id=$1 AND user_id=$2`,
    [jobId, userId],
  );
  if (!rows.length) {
    const err = new Error('import not found');
    err.statusCode = 404;
    throw err;
  }
  const job = rows[0];
  const { rows: items } = await query(
    `SELECT id, position, yt_title, yt_channel, yt_duration, tier, track_id, score, candidates, state
       FROM yt_import_items WHERE job_id=$1 ORDER BY position ASC`,
    [jobId],
  );
  const { rows: prog } = await query(
    `SELECT COUNT(*) FILTER (WHERE tier IS NULL AND state='pending')::int AS unresolved
       FROM yt_import_items WHERE job_id=$1`,
    [jobId],
  );
  return { job, items, matching: prog[0]?.unresolved ?? 0 };
}
