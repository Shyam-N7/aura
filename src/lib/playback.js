import { fetchAuthed } from './auth';

// Near-real-time multi-device awareness. The playing device heartbeats its current
// track; other devices poll /now to show a passive "playing on <device>" note;
// /resume powers cross-device "continue where you left off". All best-effort —
// failures never disrupt playback.

export async function sendHeartbeat({ track, isPlaying, progress }, { keepalive = false } = {}) {
  try {
    await fetchAuthed('/api/playback/heartbeat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ track, isPlaying, progress }),
      keepalive,   // survives page unload for the "stopped" beat on pagehide
    });
  } catch { /* best-effort — awareness is non-critical */ }
}

export async function getNowPlaying({ signal } = {}) {
  try {
    const res = await fetchAuthed('/api/playback/now', { signal });
    if (!res.ok) return [];
    const { playing } = await res.json();
    return playing ?? [];
  } catch { return []; }
}

export async function getResume({ signal } = {}) {
  try {
    const res = await fetchAuthed('/api/playback/resume', { signal });
    if (!res.ok) return null;
    const { resume } = await res.json();
    return resume ?? null;
  } catch { return null; }
}
