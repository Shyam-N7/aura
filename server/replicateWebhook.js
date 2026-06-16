// Replicate webhook signature verification — the Standard Webhooks scheme
// (https://www.standardwebhooks.com) that Replicate implements. The signing
// secret (whsec_<base64>, from `GET /v1/webhooks/default/secret`) signs the
// content `${webhook-id}.${webhook-timestamp}.${rawBody}` with HMAC-SHA256; the
// `webhook-signature` header carries a space-delimited list of `v1,<base64sig>`
// entries (key rotation can list several). A request is authentic if any entry
// matches. Verifying the signature means no shared secret has to ride in the
// callback URL (which Replicate stores + logs).
//
// Pure (only node:crypto) so it unit-tests in isolation without the db/pool.

import crypto from 'node:crypto';

// Constant-time compare of two base64 signature strings.
function safeEqual(a, b) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

// rawBody: the exact request body bytes as a string. headers: a lowercase-keyed
// object (Express req.headers already is). signingSecret: the whsec_ value.
// Returns true only on a verified signature; false on anything missing/bad.
export function verifyWebhookSignature(rawBody, headers, signingSecret) {
  try {
    if (!signingSecret || rawBody == null) return false;
    const id = headers['webhook-id'];
    const ts = headers['webhook-timestamp'];
    const sigHeader = headers['webhook-signature'];
    if (!id || !ts || !sigHeader) return false;

    const secret = signingSecret.startsWith('whsec_') ? signingSecret.slice(6) : signingSecret;
    const key = Buffer.from(secret, 'base64');
    const signed = `${id}.${ts}.${rawBody}`;
    const expected = crypto.createHmac('sha256', key).update(signed).digest('base64');

    // Header form: "v1,<sig> v1,<sig2> …" — accept a match on any versioned entry.
    for (const part of String(sigHeader).split(' ')) {
      const sig = part.split(',')[1];
      if (sig && safeEqual(sig, expected)) return true;
    }
    return false;
  } catch {
    return false;
  }
}
