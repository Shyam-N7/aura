// The in-app notification feed (the bell/panel) — a durable log of the SAME
// cards the push triggers compose (server/notify.js). It is NOT gated on push
// prefs/quiet hours/frequency caps: the panel is the quiet channel, so it
// always gets the row even when sendCategory silently no-ops the push.
// recordNotification is fire-and-forget safe: it swallows its own errors so a
// logging hiccup can never fail the trigger (or request) that caused it.
import { query } from './db.js';

const MAX_TITLE = 120;
const MAX_BODY = 300;
const MAX_URL = 1000;
const RETENTION_MS = 60 * 86400_000; // 60 days
const LIST_CAP = 50;

function httpsUrl(v) {
  return typeof v === 'string' && /^https:\/\//.test(v) && v.length <= MAX_URL ? v : null;
}

// Writes one row for `userId` and prunes that same user's rows older than 60
// days — piggybacked on the write that just touched them, so the table stays
// bounded with no separate cron.
export async function recordNotification(userId, type, { title, body, image, link } = {}) {
  try {
    const payload = {
      title: typeof title === 'string' ? title.slice(0, MAX_TITLE) : '',
      body: typeof body === 'string' ? body.slice(0, MAX_BODY) : '',
      image: httpsUrl(image),
      link: httpsUrl(link),
    };
    const now = Date.now();
    await query(
      `INSERT INTO notifications (user_id, type, payload, created_at) VALUES ($1, $2, $3, $4)`,
      [userId, type, JSON.stringify(payload), now],
    );
    await query('DELETE FROM notifications WHERE user_id = $1 AND created_at < $2', [userId, now - RETENTION_MS]);
  } catch (err) {
    console.warn('[notifications] record failed:', err?.message ?? err);
  }
}

// Newest first, hard-capped at 50 regardless of what the caller asks for.
export async function listNotifications(userId, { limit = 30 } = {}) {
  const n = Math.min(Math.max(Number(limit) || 30, 1), LIST_CAP);
  const { rows } = await query(
    `SELECT id, type, payload, created_at, seen_at FROM notifications
     WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [userId, n],
  );
  return rows.map(r => ({
    id: Number(r.id),
    type: r.type,
    payload: r.payload,
    createdAt: Number(r.created_at),
    seenAt: r.seen_at == null ? null : Number(r.seen_at),
  }));
}

// Marks every currently-unseen row seen — the panel calls this on open.
export async function markNotificationsSeen(userId) {
  await query('UPDATE notifications SET seen_at = $1 WHERE user_id = $2 AND seen_at IS NULL', [Date.now(), userId]);
}
