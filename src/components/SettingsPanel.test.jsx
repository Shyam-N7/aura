import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { SettingsPanel } from './SettingsPanel';

vi.mock('../lib/auth', () => ({ logout: vi.fn() }));
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
    const sw = getByRole('switch');
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

  it('keeps delete last, after sign out', () => {
    const { getByText } = renderPanel();
    const signOut = getByText('sign out');
    const del = getByText('delete my account');
    expect(signOut.compareDocumentPosition(del) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
