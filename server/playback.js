// Near-real-time "playing on another device" awareness + cross-device resume,
// built on the per-device user_sessions row (no new table, no push channel). The
// playing device heartbeats its current track into its OWN row (~every 20s + on
// play/pause/track change); other devices poll getNowPlaying. A session counts as
// "currently playing" only while its heartbeat is fresh.

import { query } from './db.js';

const FRESH_MS = 60 * 1000;   // a heartbeat older than this → not currently playing
const TITLE_MAX = 300, ARTIST_MAX = 200, IMG_MAX = 1000, ID_MAX = 200;

const clamp = (s, max) => (s == null ? null : String(s).slice(0, max));

function cleanTrack(track) {
  if (!track || !track.id) return null;
  return {
    id: clamp(track.id, ID_MAX),
    title: clamp(track.title, TITLE_MAX),
    artist: clamp(track.artist, ARTIST_MAX),
    imageUrl: clamp(track.imageUrl, IMG_MAX),
  };
}

// The playing device updates ITS OWN session row. No-op for legacy (no-sid)
// sessions — they simply don't participate in awareness. `progress` is a 0–1
// fraction (stored in the position_sec column) so cross-device resume can seek
// without knowing the track duration.
export async function recordHeartbeat(sessionId, userId, { track, isPlaying, progress } = {}) {
  if (!sessionId) return;
  const t = cleanTrack(track);
  const now = Date.now();
  const prog = Math.max(0, Math.min(1, Number(progress) || 0));
  await query(
    `UPDATE user_sessions
        SET playing_track = $3, is_playing = $4, position_sec = $5, playing_at = $6, last_seen_at = $6
      WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`,
    [sessionId, userId, t ? JSON.stringify(t) : null, !!isPlaying, prog, now],
  );
}

// This user's OTHER devices currently playing (fresh heartbeat + is_playing),
// newest first, excluding the caller's own session.
export async function getNowPlaying(userId, currentSid) {
  const { rows } = await query(
    `SELECT device_label, playing_track, playing_at
       FROM user_sessions
      WHERE user_id = $1 AND revoked_at IS NULL AND is_playing = TRUE
        AND playing_at > $2 AND id <> $3
      ORDER BY playing_at DESC`,
    [userId, Date.now() - FRESH_MS, currentSid ?? ''],
  );
  return rows.map(r => ({ deviceLabel: r.device_label, track: r.playing_track, since: Number(r.playing_at) }));
}

// Most-recent real playback on the user's OTHER devices (for cross-device resume).
// Excludes the caller's own session (so its idle cold-boot heartbeat can't shadow a
// genuinely-newer other device), and requires a meaningful position + a fresh-ish
// heartbeat so a stale or just-started row isn't offered.
export async function getResume(userId, currentSid) {
  const { rows } = await query(
    `SELECT playing_track, position_sec, playing_at
       FROM user_sessions
      WHERE user_id = $1 AND revoked_at IS NULL AND playing_track IS NOT NULL
        AND id <> $2 AND position_sec > 0.02 AND playing_at > $3
      ORDER BY playing_at DESC LIMIT 1`,
    [userId, currentSid ?? '', Date.now() - 24 * 60 * 60 * 1000],
  );
  if (!rows.length || !rows[0].playing_track) return null;
  return { track: rows[0].playing_track, progress: Number(rows[0].position_sec) || 0, at: Number(rows[0].playing_at) };
}
