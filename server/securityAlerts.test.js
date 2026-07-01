import { describe, it, expect, vi, beforeEach } from 'vitest';

// email.js is pure; mock the DB so foreignConcurrentCountry's single query is
// controllable and no real connection is attempted. (vi.mock is hoisted above the imports.)
vi.mock('./db.js', () => ({ query: vi.fn(), pool: {} }));

import { query } from './db.js';
import { foreignConcurrentCountry } from './securityAlerts.js';
import { renderNewDeviceEmail } from './email.js';

describe('renderNewDeviceEmail', () => {
  it('returns subject/html/text with the device + reset-password CTA', () => {
    const m = renderNewDeviceEmail({
      name: 'Sam Doe', deviceLabel: 'Chrome · Windows',
      city: 'Chennai', country: 'IN', ip: '1.2.3.4', time: 'just now', alsoActiveIn: null,
    });
    expect(m.subject).toMatch(/new sign-in/i);
    expect(typeof m.html).toBe('string');
    expect(typeof m.text).toBe('string');
    expect(m.html).toContain('Chrome · Windows');
    expect(m.html.toLowerCase()).toContain('reset your password');
    expect(m.text).toContain('Chennai, IN');
    expect(m.html).toContain('Hi Sam');            // first-name greeting
    expect(m.html).not.toMatch(/also active in/i);
  });
  it('adds the "also active in <country>" line only when supplied', () => {
    const m = renderNewDeviceEmail({ deviceLabel: 'Safari · iOS', alsoActiveIn: 'US' });
    expect(m.html).toMatch(/also active in US/);
    expect(m.text).toMatch(/also active in US/);
  });
  it('escapes HTML in header/UA-derived fields', () => {
    const m = renderNewDeviceEmail({ deviceLabel: '<script>x</script>' });
    expect(m.html).not.toContain('<script>x</script>');
    expect(m.html).toContain('&lt;script&gt;');
  });
});

describe('foreignConcurrentCountry', () => {
  beforeEach(() => { query.mockReset(); });
  it('returns null (no query) when the current sign-in has no geo', async () => {
    expect(await foreignConcurrentCountry('u1', 'ses1', null)).toBeNull();
    expect(query).not.toHaveBeenCalled();
  });
  it('returns the differing country when another active session is elsewhere', async () => {
    query.mockResolvedValue({ rows: [{ country: 'US' }] });
    expect(await foreignConcurrentCountry('u1', 'ses1', 'IN')).toBe('US');
    expect(query).toHaveBeenCalledTimes(1);
  });
  it('returns null when no other-country session exists', async () => {
    query.mockResolvedValue({ rows: [] });
    expect(await foreignConcurrentCountry('u1', 'ses1', 'IN')).toBeNull();
  });
});
