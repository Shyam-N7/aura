// Compact relative time: "just now", "3m ago", "2h ago", "5d ago", then a date.
// Takes a unix-ms timestamp (Number or numeric string); returns '' for missing.
export function relTime(ts, now = Date.now()) {
  const t = Number(ts);
  if (!Number.isFinite(t) || t <= 0) return '';
  const s = Math.max(0, Math.floor((now - t) / 1000));
  if (s < 45) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  const w = Math.floor(d / 7);
  if (w < 5) return `${w}w ago`;
  return new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }).toLowerCase();
}
