import { fetchAuthed } from '../lib/auth';
import { invalidateHomeCache } from '../lib/homeCache';
// Fire-and-forget listening event recorder. Failures are logged to console
// but never surface to the user — recording is a background concern.

// Every ~5 listens, drop Home's listening-derived caches so the next Home visit
// refetches — what you just played reaches quick picks within the session
// instead of after a hard reload.
const INVALIDATE_EVERY = 5;
let listensSinceInvalidate = 0;

export function postEvent(track_id, kind, opts = {}) {
  if (!track_id || !kind) return;
  if (kind === 'play' || kind === 'end') {
    listensSinceInvalidate += 1;
    if (listensSinceInvalidate >= INVALIDATE_EVERY) {
      listensSinceInvalidate = 0;
      invalidateHomeCache('quickPicks', 'mostPlayed', 'recentlyPlayed');
    }
  }
  fetchAuthed('/api/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      track_id,
      kind,
      position_sec: opts.position_sec ?? null,
      mood:         opts.mood ?? null,
      language:     opts.language ?? null,
      mode:         opts.mode ?? null,
      source:       opts.source ?? null,
    }),
  }).catch(err => console.warn('[events] post failed', kind, track_id, err.message));
}
