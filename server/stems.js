// Karaoke stems — the true "music only" version of a track. The source is one
// mixed 320 kbps AAC (JioSaavn has no stems), so the instrumental is produced
// ONCE by an external separation service (MVSEP's free queue running
// BS-Roformer) and cached in Vercel Blob for every listener forever —
// process-once-share-forever, mirroring server/loudness.js.
//
// Serverless shape: separation takes minutes on the free queue, so no function
// ever waits for it. The row is a claim/state machine that the clients' own
// polls drive forward, with an atomic mutex on every cost-bearing step so
// concurrent pollers never double-submit an MVSEP job or double-upload a Blob:
//   queued     — claimed, waiting for the free tier's single job slot
//   submitting — one winner is calling MVSEP create (blocks a second create)
//   submitted  — MVSEP has the job (hash stored); in-progress polls heartbeat
//   storing    — one winner is streaming the result into Blob
//   done       — instrumental cached (instrumental_url)
//   failed     — re-claimable while tries < MAX_TRIES
// The free tier allows ONE concurrent MVSEP job per account, so a single
// non-stale submitting/submitted row acts as the global slot; other tracks
// wait in 'queued'. MVSEP fetches the audio itself (remote url mode) — this
// function never moves the source stream, only the finished ~5MB instrumental
// into Blob.

import crypto from 'node:crypto';
import { put } from '@vercel/blob';
import { pool } from './db.js';
import { getSongDetails } from './catalog.js';
import { asyncHandler } from './middleware/errors.js';

const MAX_TRIES = 3;
// A claim (queued/submitting) whose polls stopped this long ago belongs to a
// run that died — re-claimable.
const STALE_CLAIM_MS = 30 * 60 * 1000;
// The finished instrumental (one song as 320 mp3) — anything past this is
// not a song. Enforced BY BYTE COUNT during the stream, not just the header.
const MAX_DOWNLOAD_BYTES = 30 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 25 * 1000;
const MVSEP_TIMEOUT_MS = 20 * 1000;

// MVSEP get() statuses that mean "still working" — the only ones that keep a
// submitted row alive (heartbeat). Anything else (a success:false error
// envelope, a rotated token) must NOT heartbeat, so a dead job ages out to
// stale-reclaim instead of blocking the slot forever.
const IN_PROGRESS = new Set(['waiting', 'processing', 'distributing', 'merging']);

const isTrackId = (id) => !!id && typeof id === 'string' && id.length <= 64;

function badRequest(message) {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
}

// null when the separation service isn't configured — the route answers 501
// and the clients keep karaoke on the full mix.
export function mvsepConfig(env = process.env) {
  if (!env.MVSEP_API_TOKEN) return null;
  return {
    token: env.MVSEP_API_TOKEN,
    base: env.MVSEP_API_BASE || 'https://mvsep.com/api',
    // 40 = BS-Roformer, the vocal-separation quality leader on the free queue.
    sepType: Number(env.MVSEP_SEP_TYPE || 40),
  };
}

// BS-Roformer's 2-stem output is a vocals file and an instrumental file.
// Prefer the explicit name; otherwise take the one that isn't the vocals.
export function pickInstrumental(files) {
  if (!Array.isArray(files) || files.length === 0) return null;
  return (
    files.find((f) => /instrum/i.test(f?.name || '')) ||
    files.find((f) => !/vocal/i.test(f?.name || '')) ||
    null
  );
}

// Defense-in-depth SSRF guard on the file link MVSEP hands back: we fetch it
// server-side and republish it to a PUBLIC Blob, so a tampered/compromised
// response must not turn this into a fetch-proxy for internal endpoints.
// Requires https and rejects loopback / private / link-local / metadata hosts.
export function isSafePublicUrl(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:') return false;
  const host = u.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.local')) return false;
  // IPv4 literal in a private / loopback / link-local / CGNAT range.
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (a === 10 || a === 127 || a === 0) return false;
    if (a === 169 && b === 254) return false; // link-local + cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT
  }
  // IPv6 loopback / link-local / unique-local literals.
  if (host === '::1' || host.startsWith('fe80') || host.startsWith('fc') || host.startsWith('fd')) {
    return false;
  }
  return true;
}

async function readRow(trackId) {
  const { rows } = await pool.query(
    `SELECT track_id, status, hash, instrumental_url, tries, claimed_at
     FROM track_stems WHERE track_id = $1`,
    [trackId],
  );
  return rows[0] ?? null;
}

// Claim (or re-claim) a track for separation. Exactly one concurrent caller
// wins: a fresh row inserts, and an existing row is only re-claimed when it
// failed under the retry cap or a queued/submitting claim went stale.
// Submitted/storing rows are NOT reclaimed here — a poll advances those (so a
// finished-but-abandoned job is completed, never re-separated). tries counts
// real separation attempts only: a failed retry bumps it, a stale-recovery
// reclaim does not, so time spent waiting for the slot never burns the cap.
export async function claimStems(trackId, now = Date.now()) {
  const { rows } = await pool.query(
    `INSERT INTO track_stems (track_id, status, tries, claimed_at)
     VALUES ($1, 'queued', 1, $2)
     ON CONFLICT (track_id) DO UPDATE
       SET status = 'queued',
           hash = NULL,
           tries = CASE WHEN track_stems.status = 'failed'
                        THEN track_stems.tries + 1
                        ELSE track_stems.tries END,
           claimed_at = $2
       WHERE (track_stems.status = 'failed' AND track_stems.tries < $3)
          OR (track_stems.status IN ('queued', 'submitting')
              AND track_stems.claimed_at < $2 - $4)
     RETURNING track_id`,
    [trackId, now, MAX_TRIES, STALE_CLAIM_MS],
  );
  return rows.length > 0;
}

// Atomic status transition used as a mutex on every cost-bearing step: exactly
// the caller whose UPDATE matches the expected `from` status proceeds.
async function transition(trackId, from, patch = {}, now = Date.now()) {
  const sets = ['status = $2', 'claimed_at = $3'];
  const params = [trackId, patch.status ?? from, now];
  if ('hash' in patch) {
    params.push(patch.hash);
    sets.push(`hash = $${params.length}`);
  }
  if ('instrumental_url' in patch) {
    params.push(patch.instrumental_url);
    sets.push(`instrumental_url = $${params.length}`);
    params.push(now);
    sets.push(`done_at = $${params.length}`);
  }
  params.push(from);
  const fromIdx = params.length;
  const { rows } = await pool.query(
    `UPDATE track_stems SET ${sets.join(', ')}
     WHERE track_id = $1 AND status = $${fromIdx}
     RETURNING track_id`,
    params,
  );
  return rows.length > 0;
}

async function heartbeat(trackId, now = Date.now()) {
  await pool.query(`UPDATE track_stems SET claimed_at = $2 WHERE track_id = $1`, [
    trackId,
    now,
  ]);
}

// The free tier runs one job at a time — a NON-stale submitting/submitted row
// for another track means this one keeps waiting. Stale rows are ignored so an
// abandoned job can never wedge the slot for everyone (a poll or reclaim will
// clear it when its own track is next requested).
async function slotBusy(trackId, now = Date.now()) {
  const { rows } = await pool.query(
    `SELECT 1 FROM track_stems
     WHERE status IN ('submitting', 'submitted') AND track_id <> $1
       AND claimed_at >= $2 - $3 LIMIT 1`,
    [trackId, now, STALE_CLAIM_MS],
  );
  return rows.length > 0;
}

async function mvsepJson(url, init = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), MVSEP_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// Hand MVSEP the stream URL (it downloads the audio itself). The caller has
// already won the queued→submitting transition, so this is the only creator.
// On MVSEP acceptance the row advances to 'submitted' with the job hash; on a
// transient refusal (most often the account's single free slot being taken)
// it rolls back to 'queued' so a later poll retries — without burning a try.
async function submit(trackId, cfg) {
  let track;
  try {
    [track] = await getSongDetails([trackId]);
  } catch {
    // A catalog blip must not strand the row in 'submitting' (that would wedge
    // the global slot until it went stale) — roll back and let a poll retry.
    await transition(trackId, 'submitting', { status: 'queued' });
    return { status: 'waiting' };
  }
  if (!track?.streamUrl) {
    await transition(trackId, 'submitting', { status: 'failed' });
    return { status: 'failed' };
  }
  let hash;
  try {
    const form = new FormData();
    form.set('api_token', cfg.token);
    form.set('url', track.streamUrl);
    form.set('remote_type', 'direct');
    form.set('sep_type', String(cfg.sepType));
    form.set('output_format', '0'); // mp3 320 — small enough to cache forever
    const res = await mvsepJson(`${cfg.base}/separation/create`, {
      method: 'POST',
      body: form,
    });
    hash = res?.success && res?.data?.hash ? res.data.hash : null;
  } catch {
    // leave hash undefined — treated as a transient refusal (rollback below)
  }
  if (hash) {
    await transition(trackId, 'submitting', { status: 'submitted', hash });
    return { status: 'preparing' };
  }
  // Roll back so the slot is released and a later poll can retry.
  await transition(trackId, 'submitting', { status: 'queued' });
  return { status: 'waiting' };
}

// Fetch following redirects MANUALLY, re-validating every hop's url — so a
// link on an allowed host can't 302-bounce to an internal/metadata endpoint
// (redirect:'follow' would chase it blind). Caps the hop count.
const MAX_REDIRECTS = 4;
async function safeFetch(startUrl, signal) {
  let url = startUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    if (!isSafePublicUrl(url)) throw new Error('unsafe instrumental url');
    const res = await fetch(url, { signal, redirect: 'manual' });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) throw new Error('redirect without location');
      url = new URL(loc, url).toString(); // resolve relative → re-validated next loop
      continue;
    }
    return res;
  }
  throw new Error('too many redirects');
}

// Stream MVSEP's finished instrumental into Blob, enforcing the size cap BY
// COUNTING BYTES (a missing content-length header must not be a free pass to
// persist an oversized billable object). Every redirect hop is SSRF-checked.
async function storeInstrumental(trackId, fileUrl) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    const res = await safeFetch(fileUrl, ctrl.signal);
    if (!res.ok || !res.body) throw new Error(`stems fetch ${res.status}`);
    const len = Number(res.headers.get('content-length'));
    if (len > MAX_DOWNLOAD_BYTES) throw new Error('instrumental too large');
    let seen = 0;
    const capped = res.body.pipeThrough(
      new TransformStream({
        transform(chunk, controller) {
          seen += chunk.byteLength ?? chunk.length ?? 0;
          if (seen > MAX_DOWNLOAD_BYTES) {
            controller.error(new Error('instrumental too large'));
            return;
          }
          controller.enqueue(chunk);
        },
      }),
    );
    const key = `stems/${trackId}-${crypto.randomBytes(8).toString('hex')}.mp3`;
    const { url } = await put(key, capped, {
      access: 'public',
      contentType: 'audio/mpeg',
      addRandomSuffix: false,
    });
    return url;
  } finally {
    clearTimeout(timer);
  }
}

// Advance a submitted row by polling MVSEP once. 'done' downloads+stores under
// a storing mutex (so two pollers can't both upload); a terminal MVSEP status
// fails the row; an in-progress status heartbeats it; anything unrecognized
// (error envelope, rotated token) is left to age out — NOT heartbeated.
async function pollSubmitted(row, cfg) {
  const trackId = row.track_id;
  let res;
  try {
    res = await mvsepJson(
      // MVSEP's get endpoint authenticates by query param only (its create call
      // takes the token in the body; get has no body). Exposure is confined to
      // MVSEP-side logs — this app never logs the outbound url.
      `${cfg.base}/separation/get?hash=${encodeURIComponent(row.hash)}` +
        `&api_token=${encodeURIComponent(cfg.token)}&mirror=0`,
    );
  } catch {
    // A transient MVSEP/network blip must not 500 the poll (which would skip
    // the client's ride) — report in-progress WITHOUT heartbeat, so a
    // sustained outage still ages the row out to stale-reclaim.
    return { status: 'preparing' };
  }
  const status = res?.status;
  if (status === 'done') {
    const file = pickInstrumental(res?.data?.files);
    if (!file?.link) {
      await transition(trackId, 'submitted', { status: 'failed' });
      return { status: 'failed' };
    }
    // Only the poller that wins submitted→storing does the download+upload.
    if (!(await transition(trackId, 'submitted', { status: 'storing' }))) {
      return { status: 'preparing' };
    }
    try {
      const url = await storeInstrumental(trackId, file.link);
      await transition(trackId, 'storing', {
        status: 'done',
        instrumental_url: url,
      });
      return { status: 'done', url };
    } catch {
      await transition(trackId, 'storing', { status: 'failed' });
      return { status: 'failed' };
    }
  }
  if (status === 'failed' || status === 'not_found') {
    await transition(trackId, 'submitted', { status: 'failed' });
    return { status: 'failed' };
  }
  if (IN_PROGRESS.has(status)) {
    await heartbeat(trackId);
    return { status: 'preparing', queue: res?.data?.current_order ?? null };
  }
  // Unrecognized (error envelope / rotated token): don't heartbeat, so the row
  // ages out to stale-reclaim rather than blocking the slot forever.
  return { status: 'preparing' };
}

// One idempotent endpoint drives everything: the first call claims, every
// later call advances whatever state the row is in and reports it. The client
// just keeps calling while it shows "preparing…".
export function stemsRequestHandler() {
  return asyncHandler(async (req, res) => {
    const trackId = req.body?.trackId;
    if (!isTrackId(trackId)) throw badRequest('invalid track id');
    const cfg = mvsepConfig();
    if (!cfg) {
      return res.status(501).json({ error: 'stems not configured' });
    }

    let row = await readRow(trackId);
    const stale =
      row && Number(row.claimed_at) < Date.now() - STALE_CLAIM_MS;

    // A submitted row is always advanced by a poll — even a stale one, so a
    // finished-but-abandoned job is completed rather than re-separated (only a
    // poll that comes back not_found/failed drops it to the reclaim path).
    if (row && row.status === 'submitted') {
      return res.json(await pollSubmitted(row, cfg));
    }
    // An in-flight 'submitting' (mid-create) or 'storing' (mid-download) winner
    // is left to finish — UNLESS its claim went stale, meaning it crashed, in
    // which case fail it so the reclaim path can retry under the try cap.
    if (row && (row.status === 'submitting' || row.status === 'storing')) {
      if (!stale) {
        return res.json({ status: 'preparing' });
      }
      await transition(trackId, row.status, { status: 'failed' });
      row = await readRow(trackId);
    }

    if (!row || row.status === 'failed') {
      await claimStems(trackId);
      row = await readRow(trackId);
    }
    if (!row) throw new Error('stems row missing after claim');

    if (row.status === 'done' && row.instrumental_url) {
      return res.json({ status: 'done', url: row.instrumental_url });
    }
    if (row.status === 'failed') {
      // Burned its retries (claim refused to re-arm it) — tell the client
      // plainly instead of promising a prepare that will never come.
      return res.json({ status: 'failed' });
    }
    // queued — take the slot if it's open, atomically, so only one caller
    // submits. Losing the queued→submitting race means someone else got it.
    if (await slotBusy(trackId)) {
      await heartbeat(trackId); // keep an actively-polled queue slot fresh
      return res.json({ status: 'waiting' });
    }
    if (await transition(trackId, 'queued', { status: 'submitting' })) {
      return res.json(await submit(trackId, cfg));
    }
    return res.json({ status: 'waiting' });
  });
}
