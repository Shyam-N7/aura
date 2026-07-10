import { fetchAuthed } from '../lib/auth';

// Quick picks — server-ranked home ring (anchored top 3 + daily-rotating rest),
// each pick carrying a plain-sentence `reason` and an `anchor` flag. tzOffset
// keys the daily rotation to the USER'S calendar day; `salt` is the "shuffle
// all" reroll (rotating slots re-pick, anchors stay).
export async function getQuickPicks({ salt, signal } = {}) {
  const params = new URLSearchParams({ tzOffset: String(new Date().getTimezoneOffset()) });
  if (salt) params.set('salt', String(salt));
  const res = await fetchAuthed(`/api/home/quick-picks?${params}`, { signal });
  if (!res.ok) throw new Error(`quick picks failed (${res.status})`);
  const { tracks } = await res.json();
  return tracks ?? [];
}
