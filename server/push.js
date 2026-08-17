// FCM sender — the server half of push. Credentials come ONLY from the
// FIREBASE_ADMIN_JSON env var (the Firebase service-account JSON as one
// string); when it's absent every send quietly no-ops, so local dev and
// tests never need Firebase. firebase-admin loads lazily on first real send
// — the 99% of invocations that never push don't pay its import cost.
// Tokens FCM reports as gone are pruned on the spot, so the table is
// self-cleaning: register keeps it fresh, sending keeps it true.
import { query } from './db.js';

let messagingP = null;

// Read lazily from process.env, NOT via config.js: config's required() vars
// would drag the whole catalog env into this module's import graph (breaking
// isolated tests), and lazy reads are what let tests stub the var per-case.
// The variable is REGISTERED in config.js for deploy/env review — that entry
// is documentation; this is the read.
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
    })().catch(err => {
      // Do NOT leave the rejection cached: this promise lives for the warm
      // lambda's lifetime, so one transient cold-start failure would otherwise
      // disable push on this instance until it recycles, reported misleadingly
      // as no_credentials. Same bug class as the yt_match_cache poisoning.
      messagingP = null;
      throw err;
    });
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
  let initFailed = false;
  const m = await messaging().catch(err => {
    console.warn('[push] admin init failed:', err?.message ?? err);
    initFailed = true;
    return null;
  });
  // Two different absences, two different fixes: no_credentials means the env
  // var is unset; init_failed means it is set and something else broke. The
  // admin console needs to tell them apart or both read as "sent to 0 devices".
  if (!m) return { sent: 0, reason: initFailed ? 'init_failed' : 'no_credentials' };

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
      // FCM defaults an Android notification message to NORMAL priority, and a
      // normal-priority message to a dozing device is held until the next
      // maintenance window — which for a locked, idle phone is exactly the
      // moment we're trying to reach. Every push we send is user-facing and
      // already rate-limited by sendCategory below, so there is no case here
      // where deferring is the right behaviour.
      priority: 'high',
      notification: {
        ...(image ? { imageUrl: image } : {}),
        color: '#d97757',
        // Must match MainApplication.PUSH_CHANNEL_ID and the manifest's
        // default_notification_channel_id. Sending it explicitly means we keep
        // control of importance even if the manifest default is ever lost.
        channelId: 'aura.push.v1',
      },
    },
    ...(link ? { data: { link: String(link) } } : {}),
  });

  const dead = [];
  const failed = [];
  res.responses.forEach((r, i) => {
    if (r.success) return;
    if (DEAD_CODES.has(r.error?.code)) {
      dead.push(tokens[i]);
    } else {
      // Every OTHER failure used to be discarded here, which made a mismatched
      // service account indistinguishable from having no devices: HTTP 200,
      // "sent to 0", zero log lines. Keep the first code — one is enough to
      // name the problem, and mismatched-credential is the classic.
      failed.push(r.error?.code ?? 'unknown');
    }
  });
  if (dead.length) {
    await query('DELETE FROM push_tokens WHERE token = ANY($1::text[])', [dead])
      .catch(() => {});
  }
  if (failed.length) {
    console.warn(`[push] ${failed.length} send(s) failed: ${failed[0]}`);
  }
  return {
    sent: res.successCount,
    ...(res.failureCount ? { failed: res.failureCount } : {}),
    ...(failed.length ? { error: failed[0] } : {}),
  };
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

// Every push wears the composed card (the /api/push/card-art endpoint):
// art-backed when a track cover exists, the brand-only card otherwise — one
// look for ALL notifications. `seed` gives artless cards their own ribbon
// wave (deterministic, so the edge cache still holds).
const CARD_ART_BASE = 'https://www.aurafm.live/api/push/card-art';
export function cardArtUrl(art, seed) {
  const q = [];
  if (art) q.push(`art=${encodeURIComponent(art)}`);
  else if (seed) q.push(`seed=${encodeURIComponent(seed)}`);
  return q.length ? `${CARD_ART_BASE}?${q.join('&')}` : CARD_ART_BASE;
}
