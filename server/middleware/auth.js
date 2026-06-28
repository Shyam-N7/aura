import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { pool, query, isTransient } from '../db.js';

// Session token lives in an httpOnly cookie (not readable by JS → not stealable
// by XSS). The SPA and /api are same-origin, so the cookie rides every
// same-origin fetch automatically and SameSite=Strict blocks cross-site sends
// (CSRF). A Bearer header is still accepted as a fallback for non-browser
// clients / tests. (security: M2 / #22)
export const SESSION_COOKIE = 'aura_session';
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days — matches the JWT expiry.
// How stale `last_seen_at` may get before a request refreshes it — keeps the
// device list's "last active" useful without a write on every authed request.
const LAST_SEEN_THROTTLE_MS = 5 * 60 * 1000;

const secret = () => {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error('JWT_SECRET not set');
  return s;
};

// Bind the token to the user's current token_version (the global "log out
// everywhere" kill switch) AND, since sessions exist, a per-login `sid` so a
// single device can be listed + revoked without touching the others. (security: M2)
export function signToken(userId, tokenVersion = 0, sid = null) {
  const payload = { sub: userId, tv: tokenVersion };
  if (sid) payload.sid = sid;
  return jwt.sign(payload, secret(), { algorithm: 'HS256', expiresIn: '30d' });
}

function cookieOptions() {
  return {
    httpOnly: true,
    // Secure only in production: http://localhost dev can't send Secure cookies.
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
  };
}

export function setSessionCookie(res, token) {
  res.cookie(SESSION_COOKIE, token, { ...cookieOptions(), maxAge: MAX_AGE_MS });
}

export function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE, cookieOptions());
}

// Cookie first, then Authorization: Bearer fallback.
function readToken(req) {
  const fromCookie = req.cookies?.[SESSION_COOKIE];
  if (fromCookie) return fromCookie;
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7);
  return null;
}

// ── Device sessions ──────────────────────────────────────────────────
// A row per login. The JWT carries its `sid`; deleting/revoking the row kills
// exactly that device. Reused as the per-device now-playing registry (Wave 2).

function newSessionId() {
  return 'ses_' + crypto.randomBytes(18).toString('base64url');
}

// Compact, human device label from the UA — coarse but enough for "is this me?"
// recognition in the device list. No dependency.
export function deviceLabel(ua = '') {
  const s = String(ua);
  const browser =
    /Edg\//.test(s)     ? 'Edge'    :
    /OPR\//.test(s)     ? 'Opera'   :
    /Firefox\//.test(s) ? 'Firefox' :
    /Chrome\//.test(s)  ? 'Chrome'  :
    /Safari\//.test(s)  ? 'Safari'  : null;
  const os =
    /iPhone|iPad|iPod/.test(s)   ? 'iOS'     :
    /Android/.test(s)            ? 'Android' :
    /Windows/.test(s)            ? 'Windows' :
    /Mac OS X|Macintosh/.test(s) ? 'macOS'   :
    /Linux/.test(s)              ? 'Linux'   : null;
  if (browser && os) return `${browser} · ${os}`;
  return browser || os || 'Unknown device';
}

// Tolerant decode for Vercel's geo header (it may arrive percent-encoded);
// never throw on malformed input — this runs on the auth path.
function safeDecode(v) {
  if (!v) return null;
  try { return decodeURIComponent(String(v)).slice(0, 120); }
  catch { return String(v).slice(0, 120); }
}

// Per-request device metadata. city/country come from Vercel's edge geo headers
// (no external geo lookup); absent locally → null ("Unknown" in the UI).
function reqMeta(req) {
  const ua = String(req.headers['user-agent'] || '').slice(0, 400);
  const country = req.headers['x-vercel-ip-country'];
  return {
    userAgent: ua,
    ip: req.ip || null,
    city: safeDecode(req.headers['x-vercel-ip-city']),
    country: country ? String(country).slice(0, 8) : null,
    label: deviceLabel(ua),
  };
}

// Atomically create a session UNDER the hard device cap. Serializes concurrent
// session creation for the user on the users row (FOR UPDATE) so the count is
// authoritative — a plain count-then-insert is TOCTOU-racey and lets parallel
// logins blow past the cap. `evictSessionId` (a device the user chose to drop) is
// revoked inside the same transaction so it frees a slot atomically. Active rows
// exclude expired ones (last_seen older than a token lifetime can't be live).
// Returns { capped:true } at the cap, else { capped:false, sid, token }.
export async function createSessionWithCap(req, userId, tokenVersion, maxActive, evictSessionId) {
  // Stable identity for THIS login, generated ONCE so a retry replays idempotently.
  // The danger case is an ambiguous commit: COMMIT reaches Postgres (row inserted)
  // but the ack is lost, surfacing as a transient error → we replay. To make that
  // safe: (a) the cap COUNT excludes our own sid (so a committed-but-unacked row
  // can't make the replay see itself and falsely report "capped"), and (b) the
  // INSERT is ON CONFLICT DO NOTHING (so the replay can't add a second row). Either
  // way the replay returns a fresh valid token for the row that now exists.
  const sid = newSessionId();
  const m = reqMeta(req);

  // One transactional attempt — connects, runs, and releases its client exactly
  // once (finally), rolling back on any error.
  const attempt = async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [userId]);
      const now = Date.now();
      if (evictSessionId) {
        await client.query(
          `UPDATE user_sessions SET revoked_at = $3 WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`,
          [String(evictSessionId), userId, now],
        );
      }
      const { rows: cnt } = await client.query(
        `SELECT COUNT(*)::int AS n FROM user_sessions
         WHERE user_id = $1 AND revoked_at IS NULL AND created_at > $2 AND id <> $3`,
        [userId, now - MAX_AGE_MS, sid],
      );
      if ((cnt[0]?.n ?? 0) >= maxActive) {
        await client.query('COMMIT');   // keep the eviction (if any); just don't create
        return { capped: true };
      }
      await client.query(
        `INSERT INTO user_sessions
           (id, user_id, device_label, user_agent, ip, city, country, created_at, last_seen_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
         ON CONFLICT (id) DO NOTHING`,
        [sid, userId, m.label, m.userAgent, m.ip, m.city, m.country, now],
      );
      await client.query('COMMIT');
      return { capped: false, sid, token: signToken(userId, tokenVersion, sid) };
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  };

  // Retry the WHOLE transaction (not individual statements) on a transient socket
  // drop — the in-flight transaction is dead, so a fresh client + idempotent replay
  // is the only safe recovery.
  for (let i = 0; ; i++) {
    try {
      return await attempt();
    } catch (e) {
      if (!isTransient(e) || i >= 2) throw e;
      await new Promise((r) => setTimeout(r, 100 * 2 ** i));
    }
  }
}

export async function listSessions(userId) {
  // Active window = token lifetime (created_at), not activity — an expired token's
  // row must drop out of the list + the cap even if it was recently active.
  const { rows } = await pool.query(
    `SELECT id, device_label, city, country, created_at, last_seen_at
     FROM user_sessions WHERE user_id = $1 AND revoked_at IS NULL AND created_at > $2
     ORDER BY last_seen_at DESC`,
    [userId, Date.now() - MAX_AGE_MS],
  );
  return rows.map(r => ({
    id:          r.id,
    deviceLabel: r.device_label,
    city:        r.city,
    country:     r.country,
    createdAt:   Number(r.created_at),
    lastSeenAt:  Number(r.last_seen_at),
  }));
}

// Soft-revoke (keeps an audit trail; the partial index drops it so it no longer
// counts toward the cap and its token stops validating). Returns true if a row
// was affected.
export async function revokeSession(userId, sid) {
  const { rowCount } = await pool.query(
    `UPDATE user_sessions SET revoked_at = $3 WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`,
    [sid, userId, Date.now()],
  );
  return rowCount > 0;
}

export async function revokeOtherSessions(userId, keepSid) {
  await pool.query(
    `UPDATE user_sessions SET revoked_at = $3 WHERE user_id = $1 AND revoked_at IS NULL AND id <> $2`,
    [userId, keepSid ?? '', Date.now()],
  );
}

export async function revokeAllSessions(userId) {
  await pool.query(
    `UPDATE user_sessions SET revoked_at = $2 WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId, Date.now()],
  );
}

// Housekeeping (run from the daily cron): drop rows whose token already expired
// and revoked rows past a short audit window, so the table stays bounded.
export async function sweepSessions() {
  const now = Date.now();
  await pool.query(
    `DELETE FROM user_sessions
      WHERE created_at < $1 OR (revoked_at IS NOT NULL AND revoked_at < $2)`,
    [now - MAX_AGE_MS, now - 7 * 24 * 60 * 60 * 1000],
  );
}

// ── Token verification ───────────────────────────────────────────────
// Verify signature + expiry with the algorithm PINNED to HS256 (no alg-confusion),
// confirm token_version still matches, and — for tokens that carry a `sid` — that
// an active (non-revoked) session row exists. Returns { userId, sid } or null.
// Throws only on a DB error (handled by callers). Tokens minted before sessions
// existed (no sid) are grandfathered: token_version check alone.
async function resolveSession(req) {
  const token = readToken(req);
  if (!token) return null;
  let decoded;
  try {
    decoded = jwt.verify(token, secret(), { algorithms: ['HS256'] });
  } catch {
    return null;
  }

  if (decoded.sid) {
    const { rows } = await query(
      `SELECT u.token_version AS tv, s.id AS sid, s.revoked_at, s.last_seen_at
       FROM users u
       LEFT JOIN user_sessions s ON s.id = $2 AND s.user_id = u.id
       WHERE u.id = $1`,
      [decoded.sub, decoded.sid],
    );
    if (!rows.length) return null;
    const r = rows[0];
    if ((r.tv ?? 0) !== (decoded.tv ?? 0)) return null;     // global revoke (e.g. password reset)
    if (!r.sid || r.revoked_at != null) return null;        // this device was revoked / is gone
    const now = Date.now();
    if (now - Number(r.last_seen_at) > LAST_SEEN_THROTTLE_MS) {
      // Best-effort, non-blocking: a cosmetic "last active" bump must never fail an
      // already-validated request (requireAuth would 500 / optionalAuth would
      // silently de-auth on a transient write error).
      query('UPDATE user_sessions SET last_seen_at = $2 WHERE id = $1', [decoded.sid, now]).catch(() => {});
    }
    return { userId: decoded.sub, sid: decoded.sid };
  }

  // Legacy token (no sid) — grandfathered.
  const { rows } = await query('SELECT token_version FROM users WHERE id = $1', [decoded.sub]);
  if (!rows.length) return null;
  if ((rows[0].token_version ?? 0) !== (decoded.tv ?? 0)) return null;
  return { userId: decoded.sub, sid: null };
}

// Identity only, NO DB / revocation check — for rate-limiter keying (grouping by
// account). A signature-valid token is enough to attribute requests to an account;
// a since-revoked token still groups under its own account, which is harmless. Never
// use this to AUTHORIZE — that's requireAuth's job.
export function peekUserId(req) {
  const token = readToken(req);
  if (!token) return null;
  try {
    return jwt.verify(token, secret(), { algorithms: ['HS256'] }).sub ?? null;
  } catch {
    return null;
  }
}

export async function requireAuth(req, res, next) {
  try {
    const s = await resolveSession(req);
    if (!s) return res.status(401).json({ error: 'invalid token' });
    req.userId = s.userId;
    req.sessionId = s.sid;
    next();
  } catch (err) {
    next(err);
  }
}

export async function optionalAuth(req, _res, next) {
  try {
    const s = await resolveSession(req);
    if (s) { req.userId = s.userId; req.sessionId = s.sid; }
  } catch { /* ignore — unauthenticated is fine; a DB blip just means "no user" */ }
  next();
}
