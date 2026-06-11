import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';
import { PlayerDrawer } from './PlayerDrawer';
import { Drawer, DrawerContent, DrawerSrTitle } from '../ui/drawer';

// The player's satellite overlays (sleep timer, lyrics, why, EQ popup) mount at
// the App root, OUTSIDE the drawer's Radix tree. A modal drawer pins
// `pointer-events: none` on <body> and aria-hides siblings, so those overlays
// painted above the drawer but were inert — taps fell through to the player.
// These tests pin the mechanism: PlayerDrawer must never lock the page.

let shell;
beforeEach(() => {
  // vaul portals into `.aura-responsive-shell` (see ui/drawer.jsx).
  shell = document.createElement('div');
  shell.className = 'aura-responsive-shell';
  document.body.appendChild(shell);
});
afterEach(() => {
  shell.remove();
  document.body.style.pointerEvents = '';
});

describe('PlayerDrawer', () => {
  it('keeps App-root overlays interactive while open (non-modal)', () => {
    const { getByText } = render(
      <>
        <PlayerDrawer open onClose={() => {}}><div>player body</div></PlayerDrawer>
        <button>sleep timer preset</button>
      </>,
    );
    expect(getByText('player body')).toBeInTheDocument();
    // The two mechanisms Radix uses to make everything outside a modal inert:
    expect(document.body.style.pointerEvents).not.toBe('none');
    const sibling = getByText('sleep timer preset');
    expect(sibling.closest('[aria-hidden="true"], [data-aria-hidden], [inert]')).toBeNull();
  });

  it('stays unlocked when opened later via the prop (the real app sequence)', () => {
    // The app keeps the drawer mounted closed and opens it by flipping `open`
    // (screen === 'player'). vaul's own body-unlock only runs on Root mount,
    // so this sequence is the one that actually locked the page in the app.
    const ui = (open) => (
      <>
        <PlayerDrawer open={open} onClose={() => {}}><div>player body</div></PlayerDrawer>
        <button>sleep timer preset</button>
      </>
    );
    const { rerender, getByText } = render(ui(false));
    rerender(ui(true));
    expect(getByText('player body')).toBeInTheDocument();
    expect(document.body.style.pointerEvents).not.toBe('none');
    const sibling = getByText('sleep timer preset');
    expect(sibling.closest('[aria-hidden="true"], [data-aria-hidden], [inert]')).toBeNull();
  });

  it('counterfactual: a default (modal) drawer DOES lock the page', () => {
    render(
      <Drawer open onOpenChange={() => {}}>
        <DrawerContent><DrawerSrTitle>modal probe</DrawerSrTitle></DrawerContent>
      </Drawer>,
    );
    expect(document.body.style.pointerEvents).toBe('none');
  });
});
