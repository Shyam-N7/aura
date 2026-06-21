import { fetchAuthed, getUser } from '../lib/auth';
import { dropExplicit } from '../lib/explicit';

export async function getRelated(trackId, { lang, limit, signal } = {}) {
  const url = new URL(`/api/tracks/${encodeURIComponent(trackId)}/related`, window.location.origin);
  if (lang) url.searchParams.set('lang', lang);
  if (limit) url.searchParams.set('limit', String(limit));
  const res = await fetchAuthed(url, { signal });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `related failed (${res.status})`);
  }
  const data = await res.json();
  // Family mode hides explicit songs from discovery. The related endpoint feeds
  // BOTH the auto-radio (queue fill) and the "more like this" rails, so filtering
  // here is the single chokepoint that covers every consumer.
  return dropExplicit(data.tracks ?? [], !!getUser()?.familyMode);
}
