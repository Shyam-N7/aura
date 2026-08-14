import { fetchAuthed } from '../lib/auth';

// YouTube import — the client side of /api/import/youtube.
//
// One rule shapes this whole file: THE CODE SURVIVES. The server answers every
// failure with {error, code}, and the client renders from `code` via
// src/lib/ytImportCopy.js — that indirection is the entire reason a wording
// change needs no server deploy and every case gets text written for it. An
// error object that drops `code` silently forces the UI back onto server prose
// and defeats the copy pack, so `fail()` below is used everywhere rather than
// throwing a bare Error.
//
// (Attaching a code to a thrown error is already the convention here — see
// addToPlaylist in ./playlists.js, which sets err.code on a 409.)

async function fail(res, fallback) {
  const body = await res.json().catch(() => ({}));
  const err = new Error(body.error || `${fallback} (${res.status})`);
  err.status = res.status;
  err.code = body.code ?? null;
  return err;
}

const json = (body) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

/**
 * Which env-gated features this deployment has.
 *
 * Called before the entry point renders. An import button that leads to a 503
 * is worse than no button, and the screens ship whether or not the key is set.
 * Never throws — a features call that fails means "assume off", which fails in
 * the safe direction.
 */
export async function getFeatures({ signal } = {}) {
  try {
    const res = await fetchAuthed('/api/features', { signal });
    if (!res.ok) return {};
    return await res.json();
  } catch {
    return {};
  }
}

/**
 * Classify a pasted link. Zero API calls server-side and zero writes, so this is
 * safe to call on every paste.
 *
 * It is also the only thing standing between the user and a spinner that
 * finishes having imported nothing: Watch Later and History return an EMPTY
 * LIST rather than an error from YouTube, so they can only be caught here.
 */
export async function previewLink(url, { signal } = {}) {
  const res = await fetchAuthed('/api/import/youtube/preview', { ...json({ url }), signal });
  if (!res.ok) throw await fail(res, 'check failed');
  return res.json();
}

/** Start an import. Returns the job view — often already finished for a small playlist. */
export async function startImport(url) {
  const res = await fetchAuthed('/api/import/youtube', json({ url }));
  if (!res.ok) throw await fail(res, 'import failed');
  return res.json();
}

/**
 * Poll a job — and, on the server, drive one slice of the work.
 *
 * Worth knowing at the call site: this is not a read. There is no background
 * worker on the deployment, so the poll IS the worker. Polling faster does more
 * work; not polling stops it (until the daily cron picks it up). That is why
 * the polling hook stops on unmount rather than running loose.
 */
export async function pollImport(jobId, { signal } = {}) {
  const res = await fetchAuthed(`/api/import/youtube/${encodeURIComponent(jobId)}`, { signal });
  if (!res.ok) throw await fail(res, 'import status failed');
  return res.json();
}

/** Accept a candidate for a review item, or skip it. Returns {pending, accepted}. */
export async function resolveItem(jobId, itemId, { trackId = null, skip = false } = {}) {
  const res = await fetchAuthed(
    `/api/import/youtube/${encodeURIComponent(jobId)}/items/${encodeURIComponent(itemId)}`,
    json({ trackId, skip }),
  );
  if (!res.ok) throw await fail(res, 'could not save that');
  return res.json();
}

/**
 * Stop an import in flight.
 *
 * Does not delete the playlist or the songs already added — the user asked to
 * stop importing, not to lose what arrived. COPY.cancel.body says so before
 * they confirm.
 */
export async function cancelImport(jobId) {
  const res = await fetchAuthed(`/api/import/youtube/${encodeURIComponent(jobId)}`, { method: 'DELETE' });
  if (!res.ok) throw await fail(res, 'could not stop the import');
  return res.json();
}

/**
 * Playlists that came from a YouTube source we can check again.
 *
 * Only finite playlists appear. A mix regenerates every time YouTube builds it,
 * so there is nothing stable to refresh against — absence from this list is
 * what hides the refresh button, rather than a flag on the playlist.
 */
export async function listLinks({ signal } = {}) {
  const res = await fetchAuthed('/api/import/youtube/links', { signal });
  if (!res.ok) throw await fail(res, 'could not check for updates');
  const { links } = await res.json();
  return links ?? [];
}

/** Check for new songs and import them. `{changed:false}` is the common answer. */
export async function refreshPlaylist(playlistId) {
  const res = await fetchAuthed('/api/import/youtube/refresh', json({ playlistId }));
  if (!res.ok) throw await fail(res, 'could not check for updates');
  return res.json();
}

/** Statuses where the server still has work to do for this job. */
export const LIVE_STATUSES = ['queued', 'fetching', 'matching'];
export const isLive = (status) => LIVE_STATUSES.includes(status);
