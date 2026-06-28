import { broadcast } from './broadcast';

const TOKEN_KEY = 'aura.authToken';
const USER_KEY  = 'aura.authUser';

let _user = null;
const subscribers = new Set();

function notify() { subscribers.forEach(fn => fn()); }

// Dev-only request trace for the auth flow (stripped from production builds).
const trace = (...a) => { if (import.meta.env.DEV) console.log('[auth]', ...a); };

try {
  const raw = localStorage.getItem(USER_KEY);
  if (raw) _user = JSON.parse(raw);
} catch { /* ignore */ }

export function getUser() { return _user; }

// The session lives in an httpOnly cookie (not readable here); `_user` is the
// client-side identity cache that drives the authed view. (security: #22)
export function isAuthed() { return !!_user; }

function setSession(user) {
  // The session token is now an httpOnly cookie set by the server — never stored
  // in JS-readable storage. We persist only the user identity for UX. (security: #22)
  try {
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  } catch { /* ignore */ }
  _user = user;
  if (user.hasOnboarded !== undefined) {
    try { localStorage.setItem('aura.hasOnboarded', user.hasOnboarded ? '1' : ''); } catch { /* localStorage unavailable */ }
  }
  if (user.seedArtists) {
    try { localStorage.setItem('aura.seedArtists', JSON.stringify(user.seedArtists)); } catch { /* localStorage unavailable */ }
  }
  if (user.seedLanguages) {
    try { localStorage.setItem('aura.seedLanguages', JSON.stringify(user.seedLanguages)); } catch { /* localStorage unavailable */ }
  }
  if (user.seedMood !== undefined) {
    try { localStorage.setItem('aura.seedMood', user.seedMood ?? ''); } catch { /* localStorage unavailable */ }
  }
  notify();
}

export function clearSession() {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem('aura.hasOnboarded');
    localStorage.removeItem('aura.seedArtists');
    localStorage.removeItem('aura.seedLanguages');
    localStorage.removeItem('aura.seedMood');
    localStorage.removeItem('aura.queue');
    localStorage.removeItem('aura.position');
    localStorage.removeItem('aura.talkHistory');
    localStorage.removeItem('aura.recentSearches');
  } catch { /* ignore */ }
  // Purge service-worker caches so a previous user's cached responses can't be
  // served to the next user on a shared device (also runs on a 401). (security: M7)
  try {
    if (typeof caches !== 'undefined') {
      caches.keys().then(keys => keys.forEach(k => caches.delete(k))).catch(() => { /* ignore */ });
    }
  } catch { /* ignore */ }
  _user = null;
  notify();
}

export async function signup({ email, name, password }) {
  const res = await fetch('/api/auth/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, name, password }),
  });
  const data = await res.json();
  if (!res.ok) throw Object.assign(new Error(data.error ?? 'signup failed'), { status: res.status, code: data.code });
  // No session yet — the account stays unverified until the emailed code is
  // entered (verifyOtp). Returns { pendingVerification, email }.
  return data;
}

export async function login({ email, password, evictSessionId } = {}) {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, evictSessionId }),
  });
  const data = await res.json();
  // Unverified account isn't an error — route the caller to the OTP step.
  if (res.status === 403 && data.pendingVerification) {
    return { pendingVerification: true, email: data.email };
  }
  // Hard device cap hit — hand the caller the device list so it can let the user
  // remove one and retry (with evictSessionId). Not an error to surface.
  if (res.status === 403 && data.code === 'device_limit') {
    return { deviceLimit: true, sessions: data.sessions ?? [], limit: data.limit };
  }
  if (!res.ok) throw Object.assign(new Error(data.error ?? 'login failed'), { status: res.status, code: data.code });
  setSession(data.user);
  return data.user;
}

export async function googleLogin(idToken, { evictSessionId } = {}) {
  const res = await fetch('/api/auth/google', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken, evictSessionId }),
  });
  const data = await res.json();
  if (res.status === 403 && data.code === 'device_limit') {
    return { deviceLimit: true, sessions: data.sessions ?? [], limit: data.limit };
  }
  if (!res.ok) throw Object.assign(new Error(data.error ?? 'google login failed'), { status: res.status });
  setSession(data.user);
  return data.user;
}

// Verify the signup code. On success the account activates and a session is
// created — the only session-creating call on the signup path.
export async function verifyOtp({ email, code, evictSessionId } = {}) {
  const res = await fetch('/api/auth/verify-otp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, code, evictSessionId }),
  });
  const data = await res.json();
  if (res.status === 403 && data.code === 'device_limit') {
    return { deviceLimit: true, sessions: data.sessions ?? [], limit: data.limit };
  }
  if (!res.ok) throw Object.assign(new Error(data.error ?? 'verification failed'), { status: res.status, code: data.code, attemptsLeft: data.attemptsLeft });
  setSession(data.user);
  return data.user;
}

// Re-send the signup code. Returns { ok, cooldownSec }; throws on cooldown 429.
export async function resendOtp(email) {
  const res = await fetch('/api/auth/resend-otp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  const data = await res.json();
  if (!res.ok) throw Object.assign(new Error(data.error ?? 'could not resend code'), { status: res.status, code: data.code, retryAfterSec: data.retryAfterSec });
  return data;
}

// Request a password-reset code. Anti-enumeration: resolves for any normal
// response. Returns { ok, cooldownSec }; throws on cooldown 429.
export async function requestReset(email) {
  trace('requestReset →', email);
  const res = await fetch('/api/auth/forgot', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  const data = await res.json();
  trace('/forgot', res.status, data);
  if (!res.ok) throw Object.assign(new Error(data.error ?? 'request failed'), { status: res.status, code: data.code, retryAfterSec: data.retryAfterSec });
  return data;
}

// Verify a reset code WITHOUT consuming it — gates the new-password step so a
// wrong code is caught before the user types a password. Returns { ok:true };
// throws with { status, code, attemptsLeft } on a bad/expired/locked code.
export async function verifyResetCode({ email, code }) {
  trace('verifyResetCode →', email, `(code len ${String(code).length})`);
  const res = await fetch('/api/auth/verify-reset-otp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, code }),
  });
  const data = await res.json();
  trace('/verify-reset-otp', res.status, data);
  if (!res.ok) throw Object.assign(new Error(data.error ?? 'verification failed'), { status: res.status, code: data.code, attemptsLeft: data.attemptsLeft });
  return data;
}

// Verify the reset code + set a new password. Does NOT create a session — the
// user re-logs in with the new password afterward. Returns { ok: true }.
export async function resetPassword({ email, code, password }) {
  trace('resetPassword →', email, `(code len ${String(code).length})`);
  const res = await fetch('/api/auth/reset-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, code, password }),
  });
  const data = await res.json();
  trace('/reset-password', res.status, res.ok ? '→ ok (re-login)' : data);
  if (!res.ok) throw Object.assign(new Error(data.error ?? 'reset failed'), { status: res.status, code: data.code, attemptsLeft: data.attemptsLeft });
  return data;
}

export async function fetchMe() {
  // Validates the httpOnly session cookie against the server. A 401 means no /
  // stale / revoked session → clear the cached identity.
  const res = await fetch('/api/auth/me');
  if (!res.ok) { clearSession(); return null; }
  const data = await res.json();
  _user = data.user;
  try { localStorage.setItem(USER_KEY, JSON.stringify(data.user)); } catch { /* localStorage unavailable */ }
  notify();
  return data.user;
}

export async function updatePreferences(prefs) {
  if (!_user) throw new Error('not authenticated');
  const res = await fetch('/api/auth/me/preferences', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(prefs),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? 'update failed');
  _user = data.user;
  try { localStorage.setItem(USER_KEY, JSON.stringify(data.user)); } catch { /* localStorage unavailable */ }
  notify();
  return data.user;
}

// ── Devices / sessions ───────────────────────────────────────────────
export async function listDevices() {
  const res = await fetchAuthed('/api/auth/sessions');
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? 'could not load devices');
  return data;   // { sessions, currentId, limit }
}

export async function revokeDevice(id) {
  const res = await fetchAuthed(`/api/auth/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('could not remove that device');
}

export async function logoutOtherDevices() {
  const res = await fetchAuthed('/api/auth/sessions?scope=others', { method: 'DELETE' });
  if (!res.ok) throw new Error('could not log out other devices');
}

// ── Family mode ──────────────────────────────────────────────────────
// Enable (set a PIN) / disable (verify the PIN). Both return the refreshed user
// (with `familyMode`) and update the in-memory session so the UI reacts at once.
export async function enableFamilyMode(pin) {
  const res = await fetchAuthed('/api/family/enable', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin }),
  });
  const data = await res.json();
  if (!res.ok) throw Object.assign(new Error(data.error ?? 'could not enable family mode'), { status: res.status, code: data.code });
  _user = data.user;
  try { localStorage.setItem(USER_KEY, JSON.stringify(data.user)); } catch { /* ignore */ }
  notify();
  return data.user;
}

export async function disableFamilyMode(pin) {
  const res = await fetchAuthed('/api/family/disable', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin }),
  });
  const data = await res.json();
  if (!res.ok) throw Object.assign(new Error(data.error ?? 'could not disable family mode'), { status: res.status, code: data.code, attemptsLeft: data.attemptsLeft, retryAfterSec: data.retryAfterSec });
  _user = data.user;
  try { localStorage.setItem(USER_KEY, JSON.stringify(data.user)); } catch { /* ignore */ }
  notify();
  return data.user;
}

// ── Listening modes ──────────────────────────────────────────────────
// Switch the active context. Returns the refreshed user (with `activeMode` + the
// `modes` view) and updates the session so the UI reacts at once.
export async function setActiveMode(key) {
  const res = await fetchAuthed('/api/modes/active', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key }),
  });
  const data = await res.json();
  if (!res.ok) throw Object.assign(new Error(data.error ?? 'could not switch mode'), { status: res.status, code: data.code });
  _user = data.user;
  try { localStorage.setItem(USER_KEY, JSON.stringify(data.user)); } catch { /* ignore */ }
  notify();
  broadcast('mode', key);   // keep other tabs on this device in sync
  return data.user;
}

// Whether the active mode hides explicit content — replaces the old global
// `familyMode` check at the dropExplicit call sites. Falls back to familyMode
// for sessions cached before modes existed.
export function getActiveExplicitOff() {
  const u = _user;
  if (!u) return false;
  const key = u.activeMode ?? 'everyday';
  const m = (u.modes ?? []).find(x => x.key === key);
  return m ? !!m.explicitOff : !!u.familyMode;
}

// Whether the "sensing" welcome intro is enabled for this user. Reads the cached
// identity synchronously (mirrors hasOnboarded) so App.jsx's screen initializer
// can decide before first paint. Defaults to ON when the field is absent (a
// session cached before this preference existed) so behaviour is unchanged.
export function showSensing() {
  return _user?.showSensing !== false;
}

export function logout() {
  // Clear the cached identity immediately (UI returns to sign-in), then tell the
  // server to clear the httpOnly session cookie so a reload can't re-auth.
  clearSession();
  // Tell other tabs on this device to clear too (they call clearSession, which
  // does NOT re-broadcast — no loop).
  broadcast('logout');
  return fetch('/api/auth/logout', { method: 'POST' }).catch(() => { /* best-effort */ });
}

// Apply a mode switch that happened in ANOTHER tab — patch the cached user so this
// tab's home/featured react, without a network call or a re-broadcast.
export function applyBroadcastMode(key) {
  if (!_user || !key || _user.activeMode === key) return;
  _user = { ..._user, activeMode: key };
  try { localStorage.setItem(USER_KEY, JSON.stringify(_user)); } catch { /* ignore */ }
  notify();
}

// A 401 from an authed call does NOT directly tear down the session — a transient
// or endpoint-specific 401 shouldn't sign you out (security: #22). Instead it
// hands off to the authoritative session check: fetchMe() re-validates against the
// server and clearSession()s iff the session is truly gone (deleted user, revoked
// or expired token). De-duped so a burst of 401s = one check; only fires when we
// currently believe we're authed.
let revalidating = false;
function revalidateSession() {
  if (revalidating || !_user) return;
  revalidating = true;
  fetchMe()
    .then(u => { if (!u) redirectToAuth(); })   // confirmed invalid → already cleared; show login
    .catch(() => { /* network blip — keep the session, re-check later */ })
    .finally(() => { revalidating = false; });
}

// Send a just-signed-out user to the login form (the gate would otherwise drop
// them on the landing page). Uses history + popstate so the in-app router picks
// it up without a full reload.
function redirectToAuth() {
  try {
    if (window.location.pathname !== '/auth') {
      window.history.pushState(null, '', '/auth');
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
  } catch { /* ignore */ }
}

// The session cookie is httpOnly and same-origin, so it rides every fetch
// automatically — no Authorization header to attach. A 401 hands off to the
// session re-check above instead of failing silently. (security: #22)
export function fetchAuthed(path, opts = {}) {
  return fetch(path, opts).then(res => {
    if (res.status === 401) revalidateSession();
    return res;
  });
}

// Catch a session invalidated while the tab was backgrounded (e.g. the account
// was deleted elsewhere): re-validate on refocus when we think we're authed.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && _user) revalidateSession();
  });
}

import { useState, useEffect } from 'react';

export function useAuth() {
  const [, rerender] = useState(0);
  useEffect(() => {
    const cb = () => rerender(n => n + 1);
    subscribers.add(cb);
    return () => subscribers.delete(cb);
  }, []);
  return { user: _user, isAuthed: isAuthed() };
}
