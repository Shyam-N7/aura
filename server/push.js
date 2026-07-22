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
