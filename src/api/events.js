import { fetchAuthed } from '../lib/auth';
// Fire-and-forget listening event recorder. Failures are logged to console
// but never surface to the user — recording is a background concern.

export function postEvent(track_id, kind, opts = {}) {
  if (!track_id || !kind) return;
  fetchAuthed('/api/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      track_id,
      kind,
      position_sec: opts.position_sec ?? null,
      mood:         opts.mood ?? null,
      language:     opts.language ?? null,
    }),
  }).catch(err => console.warn('[events] post failed', kind, track_id, err.message));
}
