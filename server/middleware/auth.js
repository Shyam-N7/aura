import jwt from 'jsonwebtoken';
import { pool } from '../db.js';

// Session token lives in an httpOnly cookie (not readable by JS → not stealable
// by XSS). The SPA and /api are same-origin, so the cookie rides every
// same-origin fetch automatically and SameSite=Strict blocks cross-site sends
// (CSRF). A Bearer header is still accepted as a fallback for non-browser
// clients / tests. (security: M2 / #22)
export const SESSION_COOKIE = 'aura_session';
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days — matches the JWT expiry.

const secret = () => {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error('JWT_SECRET not set');
  return s;
};

// Bind the token to the user's current token_version. Bumping that column
// (password reset, "log out everywhere") invalidates every previously-issued
// token — the revocation a stateless JWT otherwise can't do. (security: M2)
export function signToken(userId, tokenVersion = 0) {
  return jwt.sign({ sub: userId, tv: tokenVersion }, secret(), {
    algorithm: 'HS256',
    expiresIn: '30d',
  });
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

// Verify signature + expiry with the algorithm PINNED to HS256 (no alg-confusion),
// then confirm the token_version claim still matches the user row so revoked
// tokens are rejected. Returns the userId or null. Throws only on a DB error
// (handled by callers).
async function resolveUserId(req) {
  const token = readToken(req);
  if (!token) return null;
  let decoded;
  try {
    decoded = jwt.verify(token, secret(), { algorithms: ['HS256'] });
  } catch {
    return null;
  }
  const { rows } = await pool.query('SELECT token_version FROM users WHERE id = $1', [decoded.sub]);
  if (!rows.length) return null;
  if ((rows[0].token_version ?? 0) !== (decoded.tv ?? 0)) return null; // revoked
  return decoded.sub;
}

export async function requireAuth(req, res, next) {
  try {
    const userId = await resolveUserId(req);
    if (!userId) return res.status(401).json({ error: 'invalid token' });
    req.userId = userId;
    next();
  } catch (err) {
    next(err);
  }
}

export async function optionalAuth(req, _res, next) {
  try {
    const userId = await resolveUserId(req);
    if (userId) req.userId = userId;
  } catch { /* ignore — unauthenticated is fine; a DB blip just means "no user" */ }
  next();
}
