import { fetchAuthed } from '../lib/auth';
export async function talk({ message, history, context, signal } = {}) {
  const res = await fetchAuthed('/api/llm/talk', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, history, context }),
    signal,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `talk failed (${res.status})`);
  }
  return res.json();
}
