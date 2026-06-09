const KEY = 'aura.position';

let pending = null;
let timer = null;

export function savePosition(trackId, progress) {
  pending = { trackId, progress };
  if (!timer) {
    timer = setTimeout(flush, 5000);
  }
}

export function flush() {
  if (timer) { clearTimeout(timer); timer = null; }
  if (pending) {
    try { localStorage.setItem(KEY, JSON.stringify(pending)); }
    catch { /* localStorage disabled — non-fatal */ }
    pending = null;
  }
}

export function loadPosition() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function clearPosition() {
  // Also drop any in-flight debounced save — otherwise a pending value would be
  // re-written to storage on the next flush right after we cleared it.
  if (timer) { clearTimeout(timer); timer = null; }
  pending = null;
  try { localStorage.removeItem(KEY); } catch { /* non-fatal */ }
}
