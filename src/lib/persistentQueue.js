// Saves the user's queue to localStorage so a reload picks up where they
// left off. Catalog `streamUrl` carries CDN tokens that rotate, so we never
// persist that field — App.jsx refetches fresh URLs for the current + next
// track on restore, and lazy-refetches the rest as they become current.

const KEY = 'aura.queue';
const DEBOUNCE_MS = 400;

function stripStream(t) {
  if (!t) return t;
  // Keep the metadata we use for display + the id for refetching. Drop
  // streamUrl so a stale URL never tries to play.
  const { streamUrl, ...rest } = t;
  void streamUrl;
  return rest;
}

let saveTimer = null;
let pendingQueue = null;

function persistNow(queue) {
  try {
    const stripped = {
      tracks: (queue?.tracks ?? []).map(stripStream),
      idx:    queue?.idx ?? 0,
      source: queue?.source ?? "tonight's set",
    };
    localStorage.setItem(KEY, JSON.stringify(stripped));
  } catch { /* localStorage full / disabled */ }
}

export function saveQueueSoon(queue) {
  pendingQueue = queue;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    persistNow(pendingQueue);
    pendingQueue = null;
  }, DEBOUNCE_MS);
}

// Flush any pending debounced save on tab close so the last queue mutation
// within the DEBOUNCE_MS window isn't lost. The audit flagged that closing
// the tab within ~400 ms of a queue change could drop the most recent state.
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    if (!saveTimer) return;
    clearTimeout(saveTimer);
    saveTimer = null;
    persistNow(pendingQueue);
    pendingQueue = null;
  });
}

export function loadQueue() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.tracks)) return null;
    return {
      tracks: parsed.tracks,
      idx:    Number.isFinite(parsed.idx) ? parsed.idx : 0,
      source: parsed.source || "tonight's set",
    };
  } catch { return null; }
}

export function clearPersistedQueue() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
