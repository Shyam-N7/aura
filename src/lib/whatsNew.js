// What's-new plumbing: seen-version storage + the open/subscribe bus (the
// toast pattern — pending replay so an open fired before the host mounts is
// never dropped). The rules, per the announcement research: version-gated,
// never on a brand-new user's first session (everything is new to them),
// dismissing marks everything seen, and Settings keeps a recall entry.

import { RELEASES, LATEST_ID } from '../data/whatsNew';
import { hasOnboarded } from './onboarding';

const KEY = 'aura.whatsNewSeen';

export function getSeen() {
  try {
    const n = parseInt(localStorage.getItem(KEY), 10);
    return Number.isFinite(n) ? n : null;
  } catch { return null; }
}

export function markSeen(id = LATEST_ID) {
  try { localStorage.setItem(KEY, String(id)); } catch { /* ignore */ }
}

// First run with no key: an already-onboarded user is an EXISTING user whose
// device predates this feature — start them at 0 so the current release shows.
// A not-yet-onboarded user is brand new — mark everything seen silently.
export function initSeen() {
  if (getSeen() != null) return;
  markSeen(hasOnboarded() ? 0 : LATEST_ID);
}

export function unseenReleases() {
  const seen = getSeen() ?? LATEST_ID;
  return RELEASES.filter(r => r.id > seen);
}

const subs = new Set();
let pending = null;

export function openWhatsNew({ releases = RELEASES } = {}) {
  if (!releases.length) return;
  const event = { releases };
  if (subs.size === 0) { pending = event; return; }
  for (const cb of subs) cb(event);
}

export function subscribeWhatsNew(cb) {
  subs.add(cb);
  if (pending) { cb(pending); pending = null; }
  return () => { subs.delete(cb); };
}
