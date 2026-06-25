import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { verifyWebhookSignature } from './replicateWebhook.js';

// Build a Standard-Webhooks signature the way Replicate does, to prove our
// verifier accepts a correct signature and rejects anything tampered.
function sign(secretB64, id, ts, body) {
  const key = Buffer.from(secretB64, 'base64');
  return crypto.createHmac('sha256', key).update(`${id}.${ts}.${body}`).digest('base64');
}

describe('verifyWebhookSignature', () => {
  const secretB64 = Buffer.from('a-very-secret-key-for-tests-1234').toString('base64');
  const signingSecret = `whsec_${secretB64}`;
  const id = 'msg_123';
  const ts = '1700000000';
  const body = JSON.stringify({ status: 'succeeded', output: { segments: [] } });
  const headersWith = (sig) => ({ 'webhook-id': id, 'webhook-timestamp': ts, 'webhook-signature': sig });
  // Pin "now" to the signed timestamp so the replay-window check passes — these
  // cases exercise the signature, not freshness (see the replay-window block).
  const at = { now: Number(ts) * 1000 };

  it('accepts a correctly signed payload', () => {
    const sig = `v1,${sign(secretB64, id, ts, body)}`;
    expect(verifyWebhookSignature(body, headersWith(sig), signingSecret, at)).toBe(true);
  });

  it('accepts when the header lists multiple signatures (key rotation)', () => {
    const good = `v1,${sign(secretB64, id, ts, body)}`;
    expect(verifyWebhookSignature(body, headersWith(`v1,ZGVhZGJlZWY= ${good}`), signingSecret, at)).toBe(true);
  });

  it('rejects a tampered body', () => {
    const sig = `v1,${sign(secretB64, id, ts, body)}`;
    expect(verifyWebhookSignature(body + 'x', headersWith(sig), signingSecret, at)).toBe(false);
  });

  it('rejects a wrong secret', () => {
    const sig = `v1,${sign(secretB64, id, ts, body)}`;
    const other = `whsec_${Buffer.from('a-completely-different-secret-99').toString('base64')}`;
    expect(verifyWebhookSignature(body, headersWith(sig), other, at)).toBe(false);
  });

  it('rejects missing headers, body, or secret', () => {
    const sig = `v1,${sign(secretB64, id, ts, body)}`;
    expect(verifyWebhookSignature(body, {}, signingSecret, at)).toBe(false);
    expect(verifyWebhookSignature(body, headersWith(sig), '', at)).toBe(false);
    expect(verifyWebhookSignature(null, headersWith(sig), signingSecret, at)).toBe(false);
  });

  // Replay window (security: #8 / #10) — a correctly-signed message is rejected
  // once its timestamp falls outside the ±tolerance, so a captured webhook can't
  // be replayed later.
  it('rejects a correctly signed but stale (replayed) payload', () => {
    const sig = `v1,${sign(secretB64, id, ts, body)}`;
    const tenMinLater = { now: (Number(ts) + 600) * 1000 };
    expect(verifyWebhookSignature(body, headersWith(sig), signingSecret, tenMinLater)).toBe(false);
  });

  it('rejects a non-numeric timestamp', () => {
    const headers = { 'webhook-id': id, 'webhook-timestamp': 'not-a-number', 'webhook-signature': `v1,${sign(secretB64, id, ts, body)}` };
    expect(verifyWebhookSignature(body, headers, signingSecret, at)).toBe(false);
  });
});
