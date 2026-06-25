import crypto from 'node:crypto';

// Constant-time secret comparison. Hashes both sides to fixed-length SHA-256
// digests first, so it never leaks length via early-exit and never throws on
// unequal-length inputs (timingSafeEqual requires equal lengths). Used for the
// CRON bearer and the webhook URL-token. (security: #7)
export function safeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) return false;
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}
