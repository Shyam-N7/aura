const TOKEN_KEY = 'aura.authToken';
const USER_KEY  = 'aura.authUser';

let _user = null;
const subscribers = new Set();

function notify() { subscribers.forEach(fn => fn()); }

try {
  const raw = localStorage.getItem(USER_KEY);
  if (raw) _user = JSON.parse(raw);
} catch { /* ignore */ }

export function getToken() {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}

export function getUser() { return _user; }

export function isAuthed() { return !!getToken() && !!_user; }

function setSession(token, user) {
  try {
    localStorage.setItem(TOKEN_KEY, token);
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

export async function login({ email, password }) {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  // Unverified account isn't an error — route the caller to the OTP step.
  if (res.status === 403 && data.pendingVerification) {
    return { pendingVerification: true, email: data.email };
  }
  if (!res.ok) throw Object.assign(new Error(data.error ?? 'login failed'), { status: res.status, code: data.code });
  setSession(data.token, data.user);
  return data.user;
}

export async function googleLogin(idToken) {
  const res = await fetch('/api/auth/google', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken }),
  });
  const data = await res.json();
  if (!res.ok) throw Object.assign(new Error(data.error ?? 'google login failed'), { status: res.status });
  setSession(data.token, data.user);
  return data.user;
}

// Verify the signup code. On success the account activates and a session is
// created — the only session-creating call on the signup path.
export async function verifyOtp({ email, code }) {
  const res = await fetch('/api/auth/verify-otp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, code }),
  });
  const data = await res.json();
  if (!res.ok) throw Object.assign(new Error(data.error ?? 'verification failed'), { status: res.status, code: data.code, attemptsLeft: data.attemptsLeft });
  setSession(data.token, data.user);
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
  const res = await fetch('/api/auth/forgot', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  const data = await res.json();
  if (!res.ok) throw Object.assign(new Error(data.error ?? 'request failed'), { status: res.status, code: data.code, retryAfterSec: data.retryAfterSec });
  return data;
}

// Verify the reset code + set a new password. On success creates a session.
export async function resetPassword({ email, code, password }) {
  const res = await fetch('/api/auth/reset-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, code, password }),
  });
  const data = await res.json();
  if (!res.ok) throw Object.assign(new Error(data.error ?? 'reset failed'), { status: res.status, code: data.code, attemptsLeft: data.attemptsLeft });
  setSession(data.token, data.user);
  return data.user;
}

export async function fetchMe() {
  const token = getToken();
  if (!token) return null;
  const res = await fetch('/api/auth/me', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) { clearSession(); return null; }
  const data = await res.json();
  _user = data.user;
  try { localStorage.setItem(USER_KEY, JSON.stringify(data.user)); } catch { /* localStorage unavailable */ }
  notify();
  return data.user;
}

export async function updatePreferences(prefs) {
  const token = getToken();
  if (!token) throw new Error('not authenticated');
  const res = await fetch('/api/auth/me/preferences', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(prefs),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? 'update failed');
  _user = data.user;
  try { localStorage.setItem(USER_KEY, JSON.stringify(data.user)); } catch { /* localStorage unavailable */ }
  notify();
  return data.user;
}

export function logout() {
  clearSession();
}

export function fetchAuthed(path, opts = {}) {
  const token = getToken();
  const headers = { ...(opts.headers ?? {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(path, { ...opts, headers });
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
