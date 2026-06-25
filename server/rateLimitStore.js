// Optional shared store for express-rate-limit, backed by Upstash Redis over its
// REST API (serverless-native — no TCP connection per invocation, unlike a raw
// redis client). The default MemoryStore counts PER serverless instance, so on
// Vercel the effective per-IP limit scales with instance count; a shared store
// makes the limits GLOBAL across instances.
//
// Activated only when BOTH UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN
// are set; otherwise makeRateStore() returns undefined and express-rate-limit
// uses its in-memory default. The store FAILS OPEN: if Upstash is unreachable, a
// request is allowed (totalHits 0) rather than 500'd — a rate-limit backend
// outage must never take the API down. (security: #4)

import { Redis } from '@upstash/redis';

let _redis;
let _resolved = false;
function client() {
  if (_resolved) return _redis;
  _resolved = true;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  _redis = url && token ? new Redis({ url, token }) : null;
  if (_redis) console.log('[ratelimit] shared store: Upstash Redis');
  return _redis;
}

// INCR the counter and, on the first hit in the window, set its expiry; return
// [count, pttl] in a single round-trip.
const INCR_SCRIPT = `
local c = redis.call('INCR', KEYS[1])
if c == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
return {c, redis.call('PTTL', KEYS[1])}
`;

// Namespace keys by environment so a single Upstash DB shared between dev and
// prod doesn't mix rate-limit counters (dev → "dev", Vercel → "production").
const ENV = process.env.NODE_ENV || 'dev';

class UpstashStore {
  constructor(prefix) {
    this.prefix = prefix;
    this.windowMs = 60_000;
    this.redis = client();
  }

  // express-rate-limit calls this with the limiter's options at mount time.
  init(options) { this.windowMs = options.windowMs; }

  key(k) { return `rl:${ENV}:${this.prefix}:${k}`; }

  async increment(key) {
    try {
      const [hits, ttl] = await this.redis.eval(INCR_SCRIPT, [this.key(key)], [this.windowMs]);
      const remaining = Number(ttl) > 0 ? Number(ttl) : this.windowMs;
      return { totalHits: Number(hits), resetTime: new Date(Date.now() + remaining) };
    } catch (err) {
      // Fail OPEN — never let a rate-limit backend hiccup 500 the request.
      console.warn('[ratelimit] store error (failing open):', err?.message ?? err);
      return { totalHits: 0, resetTime: new Date(Date.now() + this.windowMs) };
    }
  }

  async decrement(key) { try { await this.redis.decr(this.key(key)); } catch { /* ignore */ } }
  async resetKey(key)  { try { await this.redis.del(this.key(key)); }  catch { /* ignore */ } }
}

// Returns a per-limiter store (distinct key prefix) when Upstash is configured,
// else undefined → express-rate-limit's in-memory default.
export function makeRateStore(prefix) {
  return client() ? new UpstashStore(prefix) : undefined;
}
