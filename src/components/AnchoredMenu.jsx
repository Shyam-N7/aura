import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import '../screens/PlaylistsScreen.css'; // .aura-pl-menu / .aura-pl-menu-item

const GAP = 6;

// Shared overflow-menu popover. Renders its children (`.aura-pl-menu-item`
// buttons) into the responsive shell as a fixed, content-sized `.aura-pl-menu`
// positioned off `anchorEl`. Because it's portaled + fixed it escapes the
// `overflow:auto` lists it opens from (no clipping), stays sized to its items
// (never stretches full-width), and is kept clear of the floating bottom nav by
// flipping above the trigger when space below is tight. Closes on
// outside-click / Esc / scroll / resize. Portaling into the shell (not body)
// keeps it inside the active `theme-*` scope so menu theming still applies.
//
// Usage: keep `{ id, el }` in state; render
//   {menu?.id === t.id && <AnchoredMenu anchorEl={menu.el} onClose={() => setMenu(null)}>…items…</AnchoredMenu>}
export function AnchoredMenu({ anchorEl, onClose, estHeight = 172, children }) {
  const ref = useRef(null);
  const [pos, setPos] = useState(null);
  // Hold the latest onClose without making the listener effect depend on it —
  // callers pass an inline `() => setMenu(null)`, which would otherwise re-bind
  // the document listeners on every parent render.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useLayoutEffect(() => {
    if (!anchorEl || !ref.current) return;
    const r = anchorEl.getBoundingClientRect();
    const w = ref.current.offsetWidth || 180;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // Floating bottom nav covers ~96px on compact (mobile + tablet-portrait).
    const bottomSafe = vw < 900 ? 96 : 12;
    const belowSpace = vh - r.bottom - GAP - bottomSafe;
    const aboveSpace = r.top - GAP - 12;
    const flipUp = belowSpace < Math.min(estHeight, 172) && aboveSpace > belowSpace;
    const anchorLeft = r.left < vw / 2;
    const horizontal = anchorLeft
      ? { left: Math.max(GAP, Math.min(r.left, vw - w - GAP)), right: 'auto' }
      : { right: Math.max(GAP, Math.min(vw - r.right, vw - w - GAP)), left: 'auto' };
    setPos(flipUp
      ? { top: 'auto', bottom: vh - r.top + GAP, maxHeight: Math.max(120, aboveSpace), ...horizontal }
      : { top: r.bottom + GAP, bottom: 'auto', maxHeight: Math.max(120, belowSpace), ...horizontal });
  }, [anchorEl, estHeight]);

  useEffect(() => {
    if (!anchorEl) return;
    const close = () => onCloseRef.current();
    const onDown = (e) => {
      if (ref.current?.contains(e.target) || anchorEl.contains(e.target)) return;
      close();
    };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    const onScroll = () => close();
    const onResize = () => close();
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey);
    document.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [anchorEl]);

  const target = document.querySelector('.aura-responsive-shell') ?? document.body;
  // All positioning is inline so it beats any per-screen `.aura-pl-menu`
  // override (e.g. the old full-width `left:4px; right:4px`).
  const style = {
    position: 'fixed',
    zIndex: 60,
    margin: 0,
    minWidth: 168,
    overflowY: 'auto',
    // Own every offset so the base `.aura-pl-menu` (position:absolute; right:0;
    // top:100%) can't leak in and stretch the hidden measurement pass
    // full-width, which would corrupt the offsetWidth read used for placement.
    top: 'auto', left: 'auto', right: 'auto', bottom: 'auto',
    ...(pos ?? { visibility: 'hidden', top: 0, left: 0 }),
  };

  return createPortal(
    <div ref={ref} role="menu" className="aura-pl-menu" style={style}
      onClick={(e) => e.stopPropagation()}>
      {children}
    </div>,
    target,
  );
}
