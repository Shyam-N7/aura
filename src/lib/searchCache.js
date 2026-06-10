// Module-scope cache of recent search results, so they survive the search
// screen unmounting (e.g. tapping into an album/movie then pressing back) —
// otherwise the screen re-mounts and re-fetches with a loading flash. Keyed by
// `query|lang`. Also persists the language filter, which is otherwise local
// state that resets on unmount.

const cache = new Map();
const MAX = 12;

// Pure read (safe to call during render) — no mutation.
export function getSearchResult(key) {
  return cache.get(key) ?? null;
}
export function setSearchResult(key, data) {
  cache.delete(key);                       // re-insert at the end = freshest
  cache.set(key, data);
  if (cache.size > MAX) cache.delete(cache.keys().next().value);
}

let lastLang = 'all';
export function getSearchLang() { return lastLang; }
export function setSearchLang(l) { lastLang = l || 'all'; }
