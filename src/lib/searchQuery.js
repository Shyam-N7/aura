import { useEffect, useState } from 'react';

// Singleton search-query store. The raw query text lives in module scope so the
// mobile top-bar search field and the DesktopSearch screen below it share one
// value — and so the query survives DesktopSearch unmounting (e.g. when a result
// is tapped and the player takes over, then the user returns to search). No
// persistence; the 300ms debounce stays in the consumer (DesktopSearch).
let query = '';
const subs = new Set();

export function getSearchQuery() { return query; }

export function setSearchQuery(v) {
  const next = v ?? '';
  if (next === query) return;
  query = next;
  subs.forEach(fn => fn(query));
}

export function useSearchQuery() {
  const [snap, setSnap] = useState(query);
  useEffect(() => {
    subs.add(setSnap);
    return () => { subs.delete(setSnap); };
  }, []);
  return { query: snap, setQuery: setSearchQuery };
}
