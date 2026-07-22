// Tiny shared input guards for route handlers. Catalog/DB ids are short opaque
// strings — isId rejects anything non-string or oversized before it can reach a
// SQL parameter or (worse) fall through to an upstream catalog call with junk.
// clampInt pins numeric query knobs (limit / days / hour / cursors) into an
// explicit range so a hostile or garbled value can't drive an unbounded LIMIT,
// a negative page, or a NaN into Postgres. (security: input caps)
export const MAX_ID_LEN = 64;

export function isId(v) {
  return typeof v === 'string' && v.length > 0 && v.length <= MAX_ID_LEN;
}

// Non-numeric input returns `fallback` (which may be undefined for optional
// knobs); anything numeric is truncated to an integer and clamped into [min, max].
export function clampInt(v, fallback, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.trunc(n), min), max);
}
