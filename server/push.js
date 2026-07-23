// FCM sender — the server half of push. Credentials come ONLY from the
// FIREBASE_ADMIN_JSON env var (the Firebase service-account JSON as one
// string); when it's absent every send quietly no-ops, so local dev and
// tests never need Firebase. firebase-admin loads lazily on first real send
// — the 99% of invocations that never push don't pay its import cost.
// Tokens FCM reports as gone are pruned on the spot, so the table is
// self-cleaning: register keeps it fresh, sending keeps it true.
import { query } from './db.js';

let messagingP = null;

function credentials() {
  const raw = process.env.FIREBASE_ADMIN_JSON;
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    console.warn('[push] FIREBASE_ADMIN_JSON is not valid JSON — pushes disabled');
    return null;
  }
}

async function messaging() {
  const creds = credentials();
  if (!creds) return null;
  if (!messagingP) {
    messagingP = (async () => {
      const { initializeApp, cert, getApps } = await import('firebase-admin/app');
      const { getMessaging } = await import('firebase-admin/messaging');
      if (!getApps().length) initializeApp({ credential: cert(creds) });
      return getMessaging();
    })();
  }
  return messagingP;
}

// Token-specific failures only — a payload mistake of OURS must never mass-
// delete healthy registrations.
const DEAD_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
]);

// One user, all their devices. { title, body } are the card text; `image` is
// an https URL for the big-picture slot; `link` rides in data and the app
// routes it like a share link; `collapseKey` lets a newer send of the same
// kind replace an undelivered older one.
export async function sendToUser(userId, { title, body, image, link, collapseKey } = {}) {
  const m = await messaging().catch(err => {
    console.warn('[push] admin init failed:', err?.message ?? err);
    return null;
  });
  if (!m) return { sent: 0, reason: 'no_credentials' };

  const { rows } = await query(
    'SELECT token FROM push_tokens WHERE user_id = $1',
    [userId],
  );
  if (!rows.length) return { sent: 0, reason: 'no_tokens' };
  const tokens = rows.map(r => r.token);

  const res = await m.sendEachForMulticast({
    tokens,
    notification: { title, body },
    android: {
      ...(collapseKey ? { collapseKey } : {}),
      notification: {
        ...(image ? { imageUrl: image } : {}),
        color: '#d97757',
      },
    },
    ...(link ? { data: { link: String(link) } } : {}),
  });

  const dead = [];
  res.responses.forEach((r, i) => {
    if (!r.success && DEAD_CODES.has(r.error?.code)) dead.push(tokens[i]);
  });
  if (dead.length) {
    await query('DELETE FROM push_tokens WHERE token = ANY($1::text[])', [dead])
      .catch(() => {});
  }
  return { sent: res.successCount };
}

// ── Category sends: prefs + quiet hours + frequency caps ─────────────
// Every TRIGGERED push (server/notify.js) flows through sendCategory, which
// owns the product guardrails so no individual trigger can spam. Admin sends
// use sendToUser directly — the human composing them is the cap.

export const CATEGORIES = {
  mixes:  { minGapMs: 20 * 3600_000 }, // "your mix is ready" — at most ~daily
  social: { minGapMs: 60 * 60_000 },   // playlist activity — bursts become one card an hour
  nudges: { minGapMs: 96 * 3600_000 }, // re-engagement — one every few days, no more
};
const DAILY_CAP = 4; // all categories combined, per user, per rolling day

// Quiet window 22:30–07:00 IST. We don't store per-user timezones yet, so IST
// is the honest product default for an India-first user base; the 02:00 UTC
// cron (≈07:30 IST) lands just past the window's end by design.
export function inQuietHours(now = Date.now()) {
  const m = (Math.floor(now / 60_000) + 330) % 1440; // minutes into the IST day
  return m >= 22 * 60 + 30 || m < 7 * 60;
}

// Absent row = all categories on (the default; the table only stores users
// who have touched the switches).
export async function getPrefs(userId) {
  const { rows } = await query(
    'SELECT mixes, social, nudges FROM notification_prefs WHERE user_id = $1',
    [userId],
  );
  return rows[0] ?? { mixes: true, social: true, nudges: true };
}

export async function sendCategory(userId, category, payload, { now = Date.now() } = {}) {
  const rule = CATEGORIES[category];
  if (!rule) return { sent: 0, reason: 'unknown_category' };
  if (inQuietHours(now)) return { sent: 0, reason: 'quiet_hours' };
  const prefs = await getPrefs(userId);
  if (!prefs[category]) return { sent: 0, reason: 'pref_off' };
  const { rows } = await query(
    `SELECT
       (SELECT MAX(sent_at) FROM push_log WHERE user_id = $1 AND category = $2) AS last,
       (SELECT COUNT(*)     FROM push_log WHERE user_id = $1 AND sent_at > $3) AS day`,
    [userId, category, now - 24 * 3600_000],
  );
  if (rows[0].last != null && now - Number(rows[0].last) < rule.minGapMs) {
    return { sent: 0, reason: 'capped' };
  }
  if (Number(rows[0].day) >= DAILY_CAP) return { sent: 0, reason: 'daily_cap' };
  const out = await sendToUser(userId, payload);
  if (out.sent > 0) {
    // Log only real deliveries — a no-token or no-credential miss must not
    // burn the user's cap for when they do enroll a device.
    await query(
      'INSERT INTO push_log (user_id, category, sent_at) VALUES ($1, $2, $3)',
      [userId, category, now],
    ).catch(() => {});
  }
  return out;
}

// Cap bookkeeping only needs a rolling month; the daily cron calls this.
export async function prunePushLog(now = Date.now()) {
  await query('DELETE FROM push_log WHERE sent_at < $1', [now - 30 * 86400_000]);
}
