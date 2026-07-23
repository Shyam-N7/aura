import { ADMIN_ONLY, ADMIN_EMAILS } from './config.js';

// Dev/staging admin gate. When ADMIN_ONLY is on, only allow-listed emails may
// sign up or sign in; everyone else is rejected at the auth choke points. Inert
// in prod (flag unset → always allowed), so it merges to main harmlessly.
// adminOnly/adminEmails default to config but are injectable for tests.
export function adminBlocked(email, adminOnly = ADMIN_ONLY, adminEmails = ADMIN_EMAILS) {
  if (!adminOnly) return false;
  return !adminEmails.includes(String(email ?? '').toLowerCase().trim());
}

// Prod admin AUTHORIZATION (distinct from the sign-in gate above, which is
// inert in prod): is this signed-in email on the allowlist? Gates the admin
// push console. Empty allowlist ⇒ nobody is admin — fail closed.
export function isAdminEmail(email, adminEmails = ADMIN_EMAILS) {
  const e = String(email ?? '').toLowerCase().trim();
  return !!e && adminEmails.includes(e);
}
