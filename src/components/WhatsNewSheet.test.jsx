import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen, act } from '@testing-library/react';
import { WhatsNewBody, WhatsNewSheet } from './WhatsNewSheet';
import { openWhatsNew, getSeen } from '../lib/whatsNew';
import { LATEST_ID } from '../data/whatsNew';

// The desktop card path is what jsdom can exercise deterministically (vaul's
// drawer is exercised in the real app); useViewport's jsdom default is desktop.
const releases = [
  { id: 2, date: '2026-07-08', title: 'easier to find your way around',
    items: [{ title: 'long-press any song', body: 'hold a song for more.' }] },
  { id: 1, date: '2026-07-06', title: 'made for you mixes',
    items: [{ title: 'mixes built from your plays', body: 'skips count.' }] },
];

beforeEach(() => localStorage.clear());

describe('WhatsNewBody', () => {
  it('renders every release with date, title and items', () => {
    render(<WhatsNewBody releases={releases} onDone={vi.fn()}/>);
    expect(screen.getByText('easier to find your way around')).toBeInTheDocument();
    expect(screen.getByText('made for you mixes')).toBeInTheDocument();
    expect(screen.getByText('2026-07-06')).toBeInTheDocument();
    expect(screen.getByText('hold a song for more.')).toBeInTheDocument();
  });

  it('fires onDone from the button', () => {
    const onDone = vi.fn();
    render(<WhatsNewBody releases={releases} onDone={onDone}/>);
    fireEvent.click(screen.getByText('nice'));
    expect(onDone).toHaveBeenCalled();
  });
});

describe('WhatsNewSheet (desktop card shell)', () => {
  it('opens from the bus and marks the latest release seen on every dismissal', () => {
    render(<WhatsNewSheet/>);
    expect(screen.queryByRole('dialog')).toBeNull();
    act(() => openWhatsNew({ releases }));
    expect(screen.getByRole('dialog', { name: /what's new/i })).toBeInTheDocument();
    fireEvent.click(screen.getByText('nice'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(getSeen()).toBe(LATEST_ID);
  });

  it('dismisses (and write-backs) on Escape', () => {
    render(<WhatsNewSheet/>);
    act(() => openWhatsNew({ releases }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(getSeen()).toBe(LATEST_ID);
  });
});
