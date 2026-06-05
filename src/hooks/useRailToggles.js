import { useEffect, useState } from 'react';

// Persisted user preference for the desktop sidebars. NavRail collapses to a
// 72px icon-only strip; DesktopRail slides off-screen with a thin reveal tab.
// Both states survive reloads.
const KEYS = { nav: 'aura.navCollapsed', rail: 'aura.railCollapsed' };

function readBool(key) {
  try { return localStorage.getItem(key) === '1'; } catch { return false; }
}
function writeBool(key, v) {
  try { localStorage.setItem(key, v ? '1' : '0'); } catch { /* ignore */ }
}

export function useRailToggles() {
  const [navCollapsed,  setNavCollapsed]  = useState(() => readBool(KEYS.nav));
  const [railCollapsed, setRailCollapsed] = useState(() => readBool(KEYS.rail));

  useEffect(() => { writeBool(KEYS.nav,  navCollapsed);  }, [navCollapsed]);
  useEffect(() => { writeBool(KEYS.rail, railCollapsed); }, [railCollapsed]);

  return {
    navCollapsed,  toggleNav:  () => setNavCollapsed(v => !v),  setNavCollapsed,
    railCollapsed, toggleRail: () => setRailCollapsed(v => !v), setRailCollapsed,
  };
}
