// Module-scope memory of each screen's scroll position, so it survives the
// screen unmounting on navigation (screens are conditionally rendered in
// App.jsx — leaving one destroys its DOM and its scrollTop). Open an album from
// the bottom of search, press back, and without this the search screen re-mounts
// at the top instead of where you left it. Keyed by screen + entity, e.g.
// `search|tamil`, `album|abc123`, `home`. Session-lived; a full reload starts
// fresh, which is the right default for scroll.

const positions = new Map();
// Search keys embed the (free-form) query, so the key space is unbounded over a
// session. Cap with LRU eviction (mirrors searchCache) so it can't grow forever.
const MAX = 60;

export function getScroll(key) {
  if (!key) return 0;
  return positions.get(key) ?? 0;
}
export function setScroll(key, top) {
  if (!key) return;
  positions.delete(key);                  // re-insert at the end = most-recent
  positions.set(key, Math.max(0, top | 0));
  if (positions.size > MAX) positions.delete(positions.keys().next().value);  // evict oldest
}
