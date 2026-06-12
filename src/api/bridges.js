import { fetchAuthed } from '../lib/auth';

export async function getBridge({ from, to, steps = 5, langs = [], signal } = {}) {
  const params = new URLSearchParams({ steps: String(steps) });
  if (langs?.length) params.set('langs', langs.join(','));
  const res = await fetchAuthed(
    `/api/bridges/${encodeURIComponent(from)}/${encodeURIComponent(to)}?${params}`,
    { signal },
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `bridge fetch failed (${res.status})`);
  }
  return res.json();
}

// The clairvoyant arrival: server reads the latest mood snapshot + language
// affinity and proposes tonight's journey. Hour comes from the CLIENT clock —
// the server runs in UTC on Vercel (same pattern as /api/greeting).
export async function getBridgeSuggestion({ hour = new Date().getHours(), signal } = {}) {
  const res = await fetchAuthed(`/api/bridges/suggest?hour=${hour}`, { signal });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `bridge suggest failed (${res.status})`);
  }
  return res.json();
}
