import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { SettingsPanel } from './SettingsPanel';

vi.mock('../lib/auth', () => ({
  logout: vi.fn(),
  useAuth: () => ({ user: null, isAuthed: false }),
  enableFamilyMode: vi.fn(),
  disableFamilyMode: vi.fn(),
  updatePreferences: vi.fn().mockResolvedValue({}),
  listDevices: vi.fn().mockResolvedValue({ sessions: [], currentId: null, limit: 3 }),
  revokeDevice: vi.fn().mockResolvedValue(),
  logoutOtherDevices: vi.fn().mockResolvedValue(),
}));
vi.mock('../api/account', () => ({
  exportMyData: vi.fn(),
  deleteMyAccount: vi.fn(),
}));
vi.mock('../lib/confirm', () => ({ confirm: vi.fn().mockResolvedValue(false) }));
vi.mock('../lib/toast', () => ({ toast: vi.fn() }));

const renderPanel = (setTweak = vi.fn()) =>
  render(<SettingsPanel t={{ theme: 'dusk' }} setTweak={setTweak}/>);

beforeEach(() => localStorage.clear());

describe('SettingsPanel', () => {
  it('lists the three themes with the active one marked', () => {
    const setTweak = vi.fn();
    const { getByText } = renderPanel(setTweak);
    expect(getByText('dusk').closest('button')).toHaveAttribute('aria-pressed', 'true');
    expect(getByText('midnight').closest('button')).toHaveAttribute('aria-pressed', 'false');
    expect(getByText('bloom').closest('button')).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(getByText('midnight'));
    expect(setTweak).toHaveBeenCalledWith('theme', 'midnight');
  });

  it('analytics switch covers all three consent states', () => {
    const { getByText, getByRole } = renderPanel();
    // Two switches now (analytics + family mode) — target analytics by name.
    const sw = getByRole('switch', { name: /analytics/i });
    // Undecided (null): off, with the "haven't chosen" caption.
    expect(sw).toHaveAttribute('aria-checked', 'false');
    expect(getByText(/haven't chosen yet/)).toBeInTheDocument();
    fireEvent.click(sw);
    expect(localStorage.getItem('aura.analyticsConsent')).toBe('granted');
    expect(sw).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(sw);
    expect(localStorage.getItem('aura.analyticsConsent')).toBe('denied');
    expect(getByText('analytics is off.')).toBeInTheDocument();
  });

  it('audio quality defaults to high and switching persists', () => {
    const { getByText } = renderPanel();
    expect(getByText('high').closest('button')).toHaveAttribute('aria-pressed', 'true');
    expect(getByText('normal').closest('button')).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(getByText('normal'));
    expect(localStorage.getItem('aura.audioQuality')).toBe('normal');
    expect(getByText('normal').closest('button')).toHaveAttribute('aria-pressed', 'true');
    expect(getByText('high').closest('button')).toHaveAttribute('aria-pressed', 'false');
  });

  it('volume leveling defaults ON and toggling persists', () => {
    const { getByRole, getByText } = renderPanel();
    const sw = getByRole('switch', { name: /volume leveling/i });
    expect(sw).toHaveAttribute('aria-checked', 'true');
    expect(getByText(/nothing plays too loud/)).toBeInTheDocument();
    fireEvent.click(sw);
    expect(localStorage.getItem('aura.leveling')).toBe('0');
    expect(getByText(/original loudness/)).toBeInTheDocument();
  });

  it('hides volume leveling on iOS, where el.volume writes are ignored', () => {
    vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari', platform: 'iPhone', maxTouchPoints: 5 });
    try {
      const { queryByRole } = renderPanel();
      expect(queryByRole('switch', { name: /volume leveling/i })).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('keeps delete last, after sign out', () => {
    const { getByText } = renderPanel();
    const signOut = getByText('sign out');
    const del = getByText('delete my account');
    expect(signOut.compareDocumentPosition(del) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
