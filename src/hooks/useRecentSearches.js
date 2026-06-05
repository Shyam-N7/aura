import { useEffect, useState } from 'react';

// Singleton recent-searches store. State lives in module scope so any consumer
// (right now only DesktopSearch) sees the same array. Mirrored to localStorage
// capped at 10 entries.
const STORAGE_KEY = 'aura.recentSearches';
const MAX = 10;

function read() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter(s => typeof s === 'string' && s.trim()) : [];
  } catch { return []; }
}
function write(arr) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(arr.slice(0, MAX))); } catch { /* ignore */ }
}

let items = read();
const subs = new Set();
function notify() { subs.forEach(fn => fn(items)); }

export function pushRecentSearch(q) {
  const trimmed = (q ?? '').trim();
  if (!trimmed) return;
  const lower = trimmed.toLowerCase();
  // Newest-first; drop case-insensitive duplicate.
  const next = [trimmed, ...items.filter(x => x.toLowerCase() !== lower)].slice(0, MAX);
  items = next;
  write(items);
  notify();
}
export function clearRecentSearches() {
  items = [];
  write(items);
  notify();
}

export function useRecentSearches() {
  const [snap, setSnap] = useState(items);
  useEffect(() => {
    subs.add(setSnap);
    return () => { subs.delete(setSnap); };
  }, []);
  return { items: snap, push: pushRecentSearch, clear: clearRecentSearches };
}
