// YouTube import — the HTTP surface.
//
// ── Why the poll drives the work ──
// There is no background worker here. Vercel runs a function per request and
// reclaims it when the response is sent, so "kick off a job and let it finish in
// the background" does not exist as a primitive: an invocation that returns
// stops executing. The available options are (a) hold the request open until the
// whole import finishes, (b) an external queue, or (c) let each request do a
// bounded slice of the work.
//
// (a) breaks on the 60s function ceiling for anything large and gives the user a
// spinner with no progress. (b) was ruled out — Postgres-only, no Redis. So (c):
// POST does one bounded drain, each GET poll does another, and the daily cron is
// the backstop for a user who closes the app mid-import. The lease in
// importJobs.claimJob is what makes overlapping polls safe.
//
// Every route is gated on youtubeImportEnabled(). With the key unset this router
// still mounts but answers 503 with a specific code, and the clients hide the
// entry point on the same signal.

import { Router } from 'express';
import { requireAuth } from './middleware/auth.js';
import { clientError } from './middleware/errors.js';
import { pool } from './db.js';
import { parseYouTubeLink, STRATEGY } from './youtubeUrl.js';
import { windowForKind } from './youtubeFetch.js';
import {
  youtubeImportEnabled, enqueueImport, drainJob, getJob, resolveReviewItem, STATUS,
} from './importJobs.js';

const router = Router();

// A drain inside a request must leave room for the response itself, for the
// poll's own DB reads, and for one item to overrun. The function ceiling is 60s
// (vercel.json); these sit well under it.
const POST_BUDGET_MS = 20_000;
const POLL_BUDGET_MS = 15_000;

// app.js registers a param net for 'id'/'track_id'/'user_id'/'token', but
// app.param does NOT propagate into a mounted Router, so these two are ours to
// check. It is not decoration: itemId binds against a BIGSERIAL column, so junk
// reaches Postgres as "invalid input syntax for type bigint" — a 500 on input
// that deserves a 400.
router.param('jobId', (req, res, next, v) => (
  /^yti_[a-z0-9]{1,40}$/.test(v) ? next() : res.status(400).json({ error: 'invalid import id', code: 'YT_BAD_ID' })
));
router.param('itemId', (req, res, next, v) => (
  /^\d{1,19}$/.test(v) ? next() : res.status(400).json({ error: 'invalid item id', code: 'YT_BAD_ID' })
));

function requireEnabled(req, res, next) {
  if (!youtubeImportEnabled()) {
    return res.status(503).json({
      error: 'playlist import is not available right now',
      code: 'YT_DISABLED',
    });
  }
  next();
}

// A single place that turns any thrown error into the {error, code} shape the
// clients map to copy. LinkError and the job engine's errors all carry `code`,
// which is what the client switches on — the message is a fallback for codes a
// client release has not seen yet, never the primary contract.
function fail(res, err, tag) {
  const status = Number(err?.statusCode) || 500;
  if (status >= 500) console.error(`[yt-import/${tag}]`, err);
  res.status(status).json({ error: clientError(err), code: err?.code ?? null });
}

// ── Preview: classify a pasted link, spend nothing ──────────────────
//
// Zero API calls and zero database writes, so it is safe to call on every
// keystroke-paste. This is the route that makes the paste box feel instant and,
// more importantly, the one that catches Watch Later and History BEFORE an
// import starts: those return an EMPTY LIST rather than an error from the Data
// API, so without this the user would watch a spinner succeed at importing
// nothing.
router.post('/preview', requireAuth, requireEnabled, (req, res) => {
  try {
    const link = parseYouTubeLink(req.body?.url);
    // Asked, not re-derived. An editorial mix (RDCLAK) looks like radio from
    // its prefix but is finite and gets no window, so hardcoding "RD means
    // windowed" here would tell the user we were truncating a playlist we
    // import whole.
    const window = windowForKind(link.kind);
    res.json({
      playlistId: link.playlistId,
      kind: link.kind,
      strategy: link.strategy,
      importable: link.strategy === STRATEGY.OFFICIAL,
      // A radio mix has no end — we take a window of it. The client must say so
      // up front rather than implying the whole thing was imported, because
      // there is no whole thing: the same link returns different tracks on a
      // later fetch (measured).
      windowed: window !== null,
      windowSize: window,
      // Why it can't be imported, when it can't. The client turns these into
      // instructions ("save it as a playlist first"), not error text.
      reason: link.strategy === STRATEGY.OFFICIAL ? null : link.strategy,
    });
  } catch (err) {
    fail(res, err, 'preview');
  }
});

// ── Start an import ─────────────────────────────────────────────────
//
// Returns as soon as the first slice of work is done, whether or not the import
// finished. A small playlist is often complete by the time this responds; a
// large one comes back mid-flight and the client polls. Either way the client
// code is the same, which is why the response shape does not distinguish them.
router.post('/', requireAuth, requireEnabled, async (req, res) => {
  try {
    const job = await enqueueImport(req.userId, req.body?.url);
    // Best-effort: a drain that fails has already recorded WHY on the job, and
    // the client is about to read that with getJob. Throwing here instead would
    // replace a specific, displayable reason with a generic 500.
    await drainJob(job.id, { budgetMs: POST_BUDGET_MS }).catch(() => {});
    const view = await getJob(req.userId, job.id);
    res.status(202).json(shape(view));
  } catch (err) {
    fail(res, err, 'create');
  }
});

// ── Poll — and do a slice of the work ───────────────────────────────
router.get('/:jobId', requireAuth, requireEnabled, async (req, res) => {
  try {
    // Read first, so a terminal job costs one query and never takes a lease.
    let view = await getJob(req.userId, req.params.jobId);
    const live = [STATUS.QUEUED, STATUS.FETCHING, STATUS.MATCHING].includes(view.job.status);
    if (live) {
      await drainJob(req.params.jobId, { budgetMs: POLL_BUDGET_MS }).catch(() => {});
      view = await getJob(req.userId, req.params.jobId);
    }
    res.json(shape(view));
  } catch (err) {
    fail(res, err, 'poll');
  }
});

// ── Resolve one review item ─────────────────────────────────────────
router.post('/:jobId/items/:itemId', requireAuth, requireEnabled, async (req, res) => {
  try {
    const { trackId, skip } = req.body ?? {};
    const progress = await resolveReviewItem(
      req.userId, req.params.jobId, req.params.itemId, { trackId, skip: !!skip },
    );
    res.json(progress);
  } catch (err) {
    fail(res, err, 'resolve');
  }
});

// ── Cancel ──────────────────────────────────────────────────────────
//
// Marks the job failed rather than deleting it: the playlist it may already
// have created stays (the user asked to stop importing, not to lose what
// arrived), and the row is cleaned up by the retention prune like any other.
// Only a job still in flight can be cancelled — cancelling a finished import
// would be a confusing way to spell "delete this playlist".
router.delete('/:jobId', requireAuth, requireEnabled, async (req, res) => {
  try {
    const view = await getJob(req.userId, req.params.jobId);
    if (![STATUS.QUEUED, STATUS.FETCHING, STATUS.MATCHING].includes(view.job.status)) {
      return res.status(409).json({ error: 'that import has already finished', code: 'YT_NOT_RUNNING' });
    }
    await pool.query(
      `UPDATE yt_import_jobs SET status='failed', error='cancelled', leased_until=0, updated_at=$2 WHERE id=$1`,
      [req.params.jobId, Date.now()],
    );
    res.json({ ok: true });
  } catch (err) {
    fail(res, err, 'cancel');
  }
});

/**
 * The client-facing shape.
 *
 * Deliberately NOT the database rows. Items carry YouTube-derived text that the
 * review screen needs, but nothing here leaks internal state (leases, cursors,
 * fingerprints) that would let a client build a dependency on how the queue
 * works. `matching` is the live progress counter — how many videos are still
 * unresolved — which is the only number a progress bar needs.
 */
function shape({ job, items, matching }) {
  return {
    id: job.id,
    status: job.status,
    title: job.title,
    kind: job.kind,
    // True when we took the first N of an endless mix. The copy that hangs off
    // this is the honest "snapshot, not a sync" line.
    windowed: job.windowed,
    playlistId: job.playlist_id,
    counts: {
      total: job.total_count,
      auto: job.auto_count,
      review: job.review_count,
      unmatched: job.unmatched_count,
      matching,
    },
    error: job.error ? String(job.error).split(':')[0] : null,
    items: items.map(i => ({
      id: String(i.id),
      position: i.position,
      youtube: { title: i.yt_title, channel: i.yt_channel, durationSec: i.yt_duration },
      tier: i.tier,
      state: i.state,
      trackId: i.track_id,
      score: i.score,
      candidates: i.candidates ?? [],
    })),
  };
}

export default router;
