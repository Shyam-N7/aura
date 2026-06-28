// Synced-lyrics generation: the queue + the Replicate WhisperX worker.
//
// When no provider in the chain has a song, the lyrics endpoint queues a job
// here. We transcribe-and-align the track's audio with WhisperX (on Replicate,
// pay-per-use, audio passed by URL — never stored) to produce line-timed lyrics,
// then write them back into the same `lyrics` cache the providers use.
//
// EVERYTHING here is GATED on generationEnabled(): with no REPLICATE_API_TOKEN /
// PUBLIC_BASE_URL set, the queue is never populated and the worker is never hit,
// so the app runs exactly as it does on the provider chain alone. Flip it on by
// setting those env vars (see .env.example).
//
// Job state machine (lyric_jobs.status):
//   queued ──dispatch──▶ processing ──webhook ok──▶ done
//                            │  └─webhook fail / timeout / dispatch error─┐
//                            ▼                                            │
//                          (retryOrFail): attempts<MAX ⇒ queued ; else ⇒ failed
// 'done' and 'failed' are terminal. A terminal failure also writes a 'none'
// lyrics row so the user sees a clean "not available", not a stuck "syncing…".
//
// NOTE (future): WhisperX transcribes from scratch. For songs where the catalog
// already has correct plain text, a forced-aligner (ctc-forced-aligner / MMS on
// Modal) that aligns the KNOWN text to the audio would beat ASR on accuracy,
// especially for Indian-language vocals. That is the planned next backend.

import { pool } from './db.js';
import { getTrackById } from './tracks.js';
import { enrichWithEnglish } from './lyrics.js';
import { fetchWithTimeout } from './lyricsProviders/util.js';
import {
  REPLICATE_API_TOKEN, REPLICATE_WHISPER_MODEL, PUBLIC_BASE_URL,
  LYRICS_WEBHOOK_SECRET, REPLICATE_WEBHOOK_SIGNING_SECRET, LYRICS_GEN_DAILY_CAP,
} from './config.js';

const MAX_ATTEMPTS = 3;
const STUCK_MS     = 15 * 60 * 1000;   // a 'processing' job older than this lost its webhook
const DAY_MS       = 24 * 60 * 60 * 1000;
// Per-USER daily ceiling on distinct tracks sent to generation. The global
// LYRICS_GEN_DAILY_CAP is shared by everyone, so without this one account could
// drain the whole day's budget; lyric_jobs is per-track (shared) and can't
// attribute spend to a user, hence the separate lyric_gen_attempts ledger.
const LYRICS_GEN_USER_DAILY = Math.max(1, Number(process.env.LYRICS_GEN_USER_DAILY) || 50);

// Reserve a per-user generation slot for `trackId`. Returns true (recording the
// attempt) when the user is under their 24h DISTINCT-track cap, false when at it.
// Re-requesting a track already attempted in-window doesn't consume a new slot
// (PK dedup). Soft cap — a small race can let a couple extra through; the global
// cap is the hard backstop.
export async function reserveUserGenSlot(userId, trackId) {
  const since = Date.now() - DAY_MS;
  const already = await pool.query(
    `SELECT 1 FROM lyric_gen_attempts WHERE user_id = $1 AND track_id = $2 AND ts > $3`,
    [userId, trackId, since],
  );
  if (!already.rowCount) {
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM lyric_gen_attempts WHERE user_id = $1 AND ts > $2`,
      [userId, since],
    );
    if ((rows[0]?.n ?? 0) >= LYRICS_GEN_USER_DAILY) return false;
  }
  await pool.query(
    `INSERT INTO lyric_gen_attempts (user_id, track_id, ts) VALUES ($1, $2, $3)
     ON CONFLICT (user_id, track_id) DO UPDATE SET ts = EXCLUDED.ts`,
    [userId, trackId, Date.now()],
  );
  return true;
}

// Full language name (catalog) → Whisper ISO code. Unknown ⇒ let Whisper detect.
const LANG_ISO = {
  tamil: 'ta', hindi: 'hi', english: 'en', malayalam: 'ml', kannada: 'kn',
  telugu: 'te', bengali: 'bn', punjabi: 'pa', marathi: 'mr', gujarati: 'gu',
};
function langIso(language) {
  return LANG_ISO[String(language ?? '').trim().toLowerCase()] ?? null;
}

export function generationEnabled() {
  return !!(REPLICATE_API_TOKEN && PUBLIC_BASE_URL);
}

// Shared writer for the lyrics cache — used by the request path AND the webhook,
// so there is one upsert, one shape.
export async function saveLyrics(trackId, { source, synced, payload }) {
  await pool.query(
    `INSERT INTO lyrics (track_id, source, synced, payload, fetched_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (track_id) DO UPDATE SET
       source = EXCLUDED.source, synced = EXCLUDED.synced,
       payload = EXCLUDED.payload, fetched_at = EXCLUDED.fetched_at`,
    [trackId, source, !!synced, JSON.stringify(payload ?? {}), Date.now()],
  );
}

// Create the job if new; if a prior attempt finished (done/failed), reset it for
// a fresh try (this only runs on a cache miss, which is rare/TTL-driven). Leaves
// an in-flight ('queued'/'processing') job untouched. Returns the resulting row
// so the caller can decide whether it still needs dispatching.
export async function enqueueLyricJob(trackId) {
  const now = Date.now();
  const { rows } = await pool.query(
    `INSERT INTO lyric_jobs (track_id, status, attempts, created_at, updated_at)
     VALUES ($1, 'queued', 0, $2, $2)
     ON CONFLICT (track_id) DO UPDATE SET
       status     = CASE WHEN lyric_jobs.status IN ('done','failed') THEN 'queued' ELSE lyric_jobs.status END,
       attempts   = CASE WHEN lyric_jobs.status IN ('done','failed') THEN 0      ELSE lyric_jobs.attempts END,
       updated_at = $2
     RETURNING status, attempts`,
    [trackId, now],
  );
  return rows[0];
}

// A retryable failure: bounce back to 'queued' while attempts remain, otherwise
// give up ('failed' + clear the pending lyrics row).
async function retryOrFail(trackId, error) {
  const { rows } = await pool.query(
    `UPDATE lyric_jobs
        SET status = CASE WHEN attempts >= $1 THEN 'failed' ELSE 'queued' END,
            error = $2, updated_at = $3
      WHERE track_id = $4
      RETURNING status`,
    [MAX_ATTEMPTS, String(error).slice(0, 500), Date.now(), trackId],
  );
  if (rows[0]?.status === 'failed') {
    await saveLyrics(trackId, { source: 'none', synced: false, payload: {} });
  }
}

// A terminal, non-retryable outcome (no audio, or no vocals to sync): record it
// so we never re-spend on this track.
async function settleNone(trackId, error) {
  await saveLyrics(trackId, { source: 'none', synced: false, payload: {} });
  await pool.query(
    `UPDATE lyric_jobs SET status='failed', error=$2, updated_at=$3 WHERE track_id=$1`,
    [trackId, error ? String(error).slice(0, 500) : null, Date.now()],
  );
}

// Kick off a WhisperX prediction for one track. Re-resolves the track to get a
// FRESH stream URL (CDN URLs expire). Counts the attempt BEFORE the call so a
// failing dispatch still advances toward MAX_ATTEMPTS. Replicate calls our
// webhook on completion.
export async function dispatchJob(trackId) {
  if (!generationEnabled()) return;

  const track = await getTrackById(trackId).catch(() => null);
  if (!track?.streamUrl) { await settleNone(trackId, 'no stream url'); return; }

  // Atomic spend guard + claim: flip to 'processing' (and count the attempt)
  // ONLY if we're under the daily dispatch cap, in ONE statement — so two
  // concurrent dispatches can't both pass a separate check and overshoot. The
  // cap counts jobs already dispatched (external_id set) in the last 24h. Over
  // the cap → no rows updated → leave it 'queued' for the reaper to retry.
  const now = Date.now();
  const claim = await pool.query(
    `UPDATE lyric_jobs
        SET status='processing', method='asr', attempts=attempts+1, updated_at=$2
      WHERE track_id=$1
        AND (SELECT COUNT(*) FROM lyric_jobs
              WHERE external_id IS NOT NULL AND updated_at > $3) < $4
      RETURNING track_id`,
    [trackId, now, now - DAY_MS, LYRICS_GEN_DAILY_CAP],
  );
  if (claim.rowCount === 0) {
    await pool.query(`UPDATE lyric_jobs SET status='queued', updated_at=$2 WHERE track_id=$1`, [trackId, now]);
    return;
  }
  try {
    const prediction = await createPrediction(track);
    await pool.query(
      `UPDATE lyric_jobs SET external_id=$2, updated_at=$3 WHERE track_id=$1`,
      [trackId, prediction.id, Date.now()],
    );
  } catch (err) {
    await retryOrFail(trackId, err.message);
    throw err;   // surface to the caller for logging; state is already settled
  }
}

async function createPrediction(track) {
  const [owner, modelName] = REPLICATE_WHISPER_MODEL.split('/');
  if (!owner || !modelName) throw new Error(`bad REPLICATE_WHISPER_MODEL: ${REPLICATE_WHISPER_MODEL}`);
  const endpoint = `https://api.replicate.com/v1/models/${owner}/${modelName}/predictions`;

  const webhook = new URL('/api/lyrics-jobs/webhook', PUBLIC_BASE_URL);
  webhook.searchParams.set('track_id', track.id);
  // The shared token rides in the URL only as the fallback when HMAC signing
  // isn't configured — Replicate logs the callback URL, so prefer the signature.
  if (!REPLICATE_WEBHOOK_SIGNING_SECRET && LYRICS_WEBHOOK_SECRET) {
    webhook.searchParams.set('token', LYRICS_WEBHOOK_SECRET);
  }

  const iso = langIso(track.language);
  const input = {
    audio_file: track.streamUrl,
    align_output: true,
    ...(iso ? { language: iso } : {}),
  };

  const res = await fetchWithTimeout(endpoint, {
    method: 'POST',
    ms: 20000,
    headers: {
      'Authorization': `Bearer ${REPLICATE_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ input, webhook: webhook.toString(), webhook_events_filter: ['completed'] }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Replicate ${res.status}: ${text.slice(0, 200)}`);
  }
  const body = await res.json().catch(() => null);
  if (!body?.id) throw new Error('Replicate response missing prediction id');
  return body;
}

// WhisperX returns { segments: [{ start, end, text, words: [{score}] }], ... }.
// Collapse to line-level [{t, line}], one line per segment.
function linesFromWhisperX(output) {
  const segments = Array.isArray(output?.segments) ? output.segments
    : Array.isArray(output) ? output
    : [];
  const lines = [];
  for (const seg of segments) {
    const t = Number(seg?.start);
    const line = String(seg?.text ?? '').trim();
    if (Number.isFinite(t) && line) lines.push({ t, line });
  }
  lines.sort((a, b) => a.t - b.t);
  return lines;
}

function confidenceFromWhisperX(output) {
  const segments = Array.isArray(output?.segments) ? output.segments : [];
  let sum = 0, n = 0;
  for (const seg of segments) {
    for (const w of (seg?.words ?? [])) {
      if (typeof w?.score === 'number') { sum += w.score; n++; }
    }
  }
  return n ? sum / n : null;
}

// Called by the webhook with the completed Replicate prediction.
export async function completeFromPrediction(prediction, trackId) {
  // Bind the callback to the job we actually dispatched: the prediction id must
  // match this track's stored external_id AND the job must still be 'processing'.
  // track_id rides the webhook URL (outside the HMAC), so without this a replayed
  // or forged callback could write attacker-chosen lyrics onto ANY track. A
  // mismatch is silently ignored (no write, no Replicate retry). (security: M3)
  const { rows } = await pool.query(
    'SELECT external_id, status FROM lyric_jobs WHERE track_id = $1',
    [trackId],
  );
  const job = rows[0];
  if (!job || job.status !== 'processing' || !job.external_id || job.external_id !== prediction?.id) {
    return { ignored: true };
  }
  if (prediction?.status !== 'succeeded') {
    await retryOrFail(trackId, prediction?.error ?? 'prediction failed');
    return;
  }
  const lines = linesFromWhisperX(prediction.output);
  if (!lines.length) {
    // Succeeded but nothing to sync → instrumental / no vocals. Terminal.
    await settleNone(trackId, 'no vocal lines detected');
    return;
  }
  const track = await getTrackById(trackId).catch(() => null);
  const enriched = await enrichWithEnglish({ lines, source: 'generated' }, track?.language);
  await saveLyrics(trackId, {
    source: 'generated', synced: true,
    payload: { lines: enriched.lines, has_english: enriched.has_english },
  });
  await pool.query(
    `UPDATE lyric_jobs SET status='done', confidence=$2, error=NULL, updated_at=$3 WHERE track_id=$1`,
    [trackId, confidenceFromWhisperX(prediction.output), Date.now()],
  );
}

// Cron reaper: recover jobs whose webhook never arrived, then dispatch any that
// are queued (dispatch failed at request time, bounced from a retry, or were
// over the daily cap).
export async function processQueue({ batch = 10 } = {}) {
  if (!generationEnabled()) return { dispatched: 0, recovered: 0 };

  // Housekeeping: drop per-user generation-attempt rows past the 24h cap window
  // so the ledger stays bounded (the cap COUNT only ever looks back 24h).
  await pool.query('DELETE FROM lyric_gen_attempts WHERE ts < $1', [Date.now() - DAY_MS]).catch(() => {});

  const stuck = await pool.query(
    `SELECT track_id FROM lyric_jobs WHERE status='processing' AND updated_at < $1`,
    [Date.now() - STUCK_MS],
  );
  for (const r of stuck.rows) await retryOrFail(r.track_id, 'webhook timeout');

  const queued = await pool.query(
    `SELECT track_id FROM lyric_jobs WHERE status='queued' ORDER BY updated_at LIMIT $1`,
    [batch],
  );
  let dispatched = 0;
  for (const r of queued.rows) {
    try { await dispatchJob(r.track_id); dispatched++; }
    catch (err) { console.warn('[lyrics] reaper dispatch failed:', r.track_id, err.message); }
  }
  return { dispatched, recovered: stuck.rowCount };
}
