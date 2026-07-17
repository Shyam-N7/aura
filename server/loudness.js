// Volume leveling data — per-track integrated loudness, the number JioSaavn
// doesn't provide. Each track is measured ONCE (BS.1770 via ffmpeg's ebur128
// filter, run over the same 320 kbps AAC the clients stream) and the result is
// shared by every listener forever. Clients apply it as a playout gain toward
// their leveling target; a track we haven't measured yet simply plays
// unleveled and triggers a measure for next time.
//
// The table doubles as a claim/state machine so concurrent serverless measure
// runs never duplicate the download+decode work: pending (claimed) → done |
// failed. Stale pending rows (a crashed function) and failed rows under the
// retry cap are re-claimable.
//
// ffmpeg itself is NOT imported here. The measure entrypoints inject its path:
// api/loudness-measure.js (its own Vercel function) imports ffmpeg-static
// statically so the ~80MB binary lives in that bundle alone, and app.js's
// local-dev route resolves it with a tracer-invisible dynamic import.

import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { pool } from './db.js';
import { getSongDetails } from './catalog.js';
import { asyncHandler } from './middleware/errors.js';

const MAX_TRIES = 3;
// A pending claim older than this belongs to a run that died — re-claimable.
const STALE_CLAIM_MS = 10 * 60 * 1000;
// Biggest stream we'll download for measurement (a 20-minute 320kbps file is
// ~48MB; anything past this is not a song).
const MAX_DOWNLOAD_BYTES = 60 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 25 * 1000;
const FFMPEG_TIMEOUT_MS = 30 * 1000;
// Batch read cap — a queue sync asks in pages, not all 258 at once.
const MAX_BATCH = 50;

const isTrackId = (id) => !!id && typeof id === 'string' && id.length <= 64;

function badRequest(message) {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
}

// Measured loudness for a set of tracks: { [trackId]: { lufs, truePeak } }.
// Only 'done' rows count — pending/failed tracks are simply absent, which the
// clients read as "play unleveled".
export async function getLoudness(ids) {
  const clean = [...new Set(ids)].filter(isTrackId).slice(0, MAX_BATCH);
  if (!clean.length) return {};
  const { rows } = await pool.query(
    `SELECT track_id, lufs, true_peak FROM track_loudness
     WHERE status = 'done' AND track_id = ANY($1)`,
    [clean],
  );
  const out = {};
  for (const r of rows) out[r.track_id] = { lufs: r.lufs, truePeak: r.true_peak };
  return out;
}

// Try to claim a track for measurement. Exactly one concurrent caller wins:
// a fresh row inserts, and an existing row is only re-claimed when its last
// run failed (under the retry cap) or its claim went stale.
export async function claimMeasure(trackId, now = Date.now()) {
  const { rows } = await pool.query(
    `INSERT INTO track_loudness (track_id, status, tries, claimed_at)
     VALUES ($1, 'pending', 1, $2)
     ON CONFLICT (track_id) DO UPDATE
       SET status = 'pending', tries = track_loudness.tries + 1, claimed_at = $2
     WHERE (track_loudness.status = 'failed' AND track_loudness.tries < $3)
        OR (track_loudness.status = 'pending' AND track_loudness.claimed_at < $2 - $4)
     RETURNING track_id`,
    [trackId, now, MAX_TRIES, STALE_CLAIM_MS],
  );
  return rows.length > 0;
}

async function storeMeasurement(trackId, { lufs, truePeak }, now = Date.now()) {
  await pool.query(
    `UPDATE track_loudness
     SET status = 'done', lufs = $2, true_peak = $3, measured_at = $4
     WHERE track_id = $1`,
    [trackId, lufs, truePeak, now],
  );
}

async function markFailed(trackId) {
  await pool.query(
    `UPDATE track_loudness SET status = 'failed' WHERE track_id = $1`,
    [trackId],
  );
}

// Pull the integrated loudness + true peak out of ffmpeg's ebur128 summary
// (printed to stderr at stream end). Last match wins — the running per-frame
// lines also contain "I:", the summary block comes after them all.
export function parseEbur128(text) {
  const i = [...text.matchAll(/I:\s*(-?\d+(?:\.\d+)?)\s*LUFS/g)].pop();
  const p = [...text.matchAll(/Peak:\s*(-?\d+(?:\.\d+)?)\s*dBFS/g)].pop();
  if (!i) return null;
  return { lufs: Number(i[1]), truePeak: p ? Number(p[1]) : null };
}

async function downloadTo(filePath, url) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: 'follow' });
    if (!res.ok || !res.body) throw new Error(`stream fetch ${res.status}`);
    const len = Number(res.headers.get('content-length'));
    if (len > MAX_DOWNLOAD_BYTES) throw new Error('stream too large');
    await pipeline(Readable.fromWeb(res.body), createWriteStream(filePath));
  } finally {
    clearTimeout(timer);
  }
}

function runFfmpeg(ffmpegPath, filePath) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, [
      '-hide_banner', '-nostats',
      '-i', filePath,
      '-map', 'a:0',
      '-af', 'ebur128=peak=true',
      '-f', 'null', '-',
    ]);
    let stderr = '';
    const killer = setTimeout(() => proc.kill('SIGKILL'), FFMPEG_TIMEOUT_MS);
    proc.stderr.on('data', (d) => {
      // The summary sits at the tail — keep a rolling window, never the
      // whole per-frame firehose.
      stderr = (stderr + d).slice(-64 * 1024);
    });
    proc.on('error', (err) => { clearTimeout(killer); reject(err); });
    proc.on('close', (code) => {
      clearTimeout(killer);
      if (code !== 0) return reject(new Error(`ffmpeg exit ${code}`));
      resolve(stderr);
    });
  });
}

// Download the track's 320 stream, run ebur128 over it, store the result.
// Caller must hold the claim. Any failure marks the row failed (retryable
// under the cap) and rethrows for the route's error handling.
export async function measureTrack(trackId, ffmpegPath) {
  let dir = null;
  try {
    const [track] = await getSongDetails([trackId]);
    if (!track?.streamUrl) throw new Error('no stream url');
    dir = await mkdtemp(path.join(tmpdir(), 'aura-lufs-'));
    const file = path.join(dir, 'track.mp4');
    await downloadTo(file, track.streamUrl);
    const summary = await runFfmpeg(ffmpegPath, file);
    const parsed = parseEbur128(summary);
    if (!parsed) throw new Error('ebur128 summary missing');
    await storeMeasurement(trackId, parsed);
    return parsed;
  } catch (err) {
    await markFailed(trackId).catch(() => {});
    throw err;
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

// The measure route, shared by both entrypoints (prod's dedicated function and
// the local-dev mount) — they differ only in how ffmpeg is resolved.
export function loudnessMeasureHandler(resolveFfmpeg) {
  return asyncHandler(async (req, res) => {
    const trackId = req.body?.trackId;
    if (!isTrackId(trackId)) throw badRequest('invalid track id');

    const existing = await getLoudness([trackId]);
    if (existing[trackId]) {
      return res.json({ status: 'done', ...existing[trackId] });
    }
    const ffmpegPath = await resolveFfmpeg();
    if (!ffmpegPath) {
      return res.status(501).json({ error: 'measurement unavailable here' });
    }
    const claimed = await claimMeasure(trackId);
    if (!claimed) {
      // Someone else is on it (or it burned its retries) — nothing to wait on.
      return res.status(202).json({ status: 'busy' });
    }
    const measured = await measureTrack(trackId, ffmpegPath);
    res.json({ status: 'done', ...measured });
  });
}
