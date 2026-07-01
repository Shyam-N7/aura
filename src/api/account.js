import { fetchAuthed } from '../lib/auth';

// GDPR self-service. Export returns the full data bundle; delete erases the
// account and cascades all listening history server-side.
export async function exportMyData({ signal } = {}) {
  const res = await fetchAuthed('/api/auth/me/export', { signal });
  if (!res.ok) throw new Error(`export failed (${res.status})`);
  return res.json();
}

// Google-only accounts (no password) request an emailed 'delete' code first.
export async function requestDeleteCode() {
  const res = await fetchAuthed('/api/auth/me/delete-code', { method: 'POST' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error ?? `couldn't send a code (${res.status})`), { status: res.status, code: data.code, retryAfterSec: data.retryAfterSec });
  return data;
}

// Step-up delete: pass the account password, or (Google-only) the emailed code.
export async function deleteMyAccount({ password, code } = {}) {
  const res = await fetchAuthed('/api/auth/me/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password, code }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error ?? `delete failed (${res.status})`), { status: res.status, code: data.code, attemptsLeft: data.attemptsLeft, retryAfterSec: data.retryAfterSec });
  return data;
}
