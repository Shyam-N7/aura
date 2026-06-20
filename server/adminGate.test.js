import { describe, it, expect, vi } from 'vitest';

// adminGate.js imports config.js (which fail-fasts on missing env at load) — mock
// it so the gate logic can be tested in isolation. The defaults don't matter here
// because every test injects adminOnly/adminEmails explicitly.
vi.mock('./config.js', () => ({ ADMIN_ONLY: false, ADMIN_EMAILS: [] }));

import { adminBlocked } from './adminGate.js';

describe('adminBlocked — dev/staging admin allowlist gate', () => {
  const allow = ['admin@aura.fm', 'second@aura.fm'];

  it('blocks nobody when the flag is off (inert in prod)', () => {
    expect(adminBlocked('anyone@example.com', false, allow)).toBe(false);
    expect(adminBlocked('', false, allow)).toBe(false);
  });

  it('allows an allow-listed email when the flag is on', () => {
    expect(adminBlocked('admin@aura.fm', true, allow)).toBe(false);
    expect(adminBlocked('second@aura.fm', true, allow)).toBe(false);
  });

  it('blocks a non-allow-listed email when the flag is on', () => {
    expect(adminBlocked('stranger@example.com', true, allow)).toBe(true);
  });

  it('matches case-insensitively and trims whitespace', () => {
    expect(adminBlocked('  ADMIN@Aura.FM  ', true, allow)).toBe(false);
  });

  it('blocks empty/missing emails when the flag is on', () => {
    expect(adminBlocked('', true, allow)).toBe(true);
    expect(adminBlocked(null, true, allow)).toBe(true);
    expect(adminBlocked(undefined, true, allow)).toBe(true);
  });

  it('blocks everyone when the allowlist is empty but the flag is on', () => {
    expect(adminBlocked('admin@aura.fm', true, [])).toBe(true);
  });
});
