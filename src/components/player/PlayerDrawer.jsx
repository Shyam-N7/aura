import { Drawer, DrawerContent, DrawerSrTitle } from '../ui/drawer';
import './PlayerDrawer.css';

// Full-height now-playing drawer for phones: pull it DOWN to minimise back to the
// mini bar (vaul owns the drag + slide). `screen === 'player'` stays the source
// of truth — `open` is derived from it and a dismiss calls onClose (leavePlayer),
// which flips the screen and lets vaul animate the slide-out. Desktop/tablet keep
// the routed player; only true-mobile gets the gesture.
//
// modal={false}: the player's satellite overlays — sleep timer, lyrics, why,
// the EQ popup — mount at the App root OUTSIDE this Radix tree. A modal dialog
// pins `pointer-events: none` on <body>, aria-hides everything else and traps
// focus, so the satellites painted above the drawer but were inert (taps fell
// through to the player beneath). vaul 1.1.2 never forwards `modal` to Radix's
// DialogPrimitive.Root, so this prop only works because of
// patches/vaul+1.1.2.patch (applied by the postinstall script). Non-modal vaul
// renders no overlay and preventDefault's onPointerDownOutside, so outside
// taps can't dismiss; drag-to-dismiss is unaffected.
export function PlayerDrawer({ open, instant = false, closing = false, bloomOrigin = null, onClose, children }) {
  // Origin of the clip-path bloom (the bead's viewport centre) → CSS vars the
  // --instant / --closing keyframes read, so the player grows out of / collapses
  // into the now-playing disk.
  const bloomStyle = bloomOrigin
    ? { '--bloom-x': `${bloomOrigin.x}px`, '--bloom-y': `${bloomOrigin.y}px` }
    : undefined;
  return (
    <Drawer open={open} modal={false} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DrawerContent
        className={`aura-player-drawer${instant ? ' aura-player-drawer--instant' : ''}${closing ? ' aura-player-drawer--closing' : ''}`}
        style={bloomStyle}
        showHandle={false}>
        <DrawerSrTitle>Now playing</DrawerSrTitle>
        <div className="aura-player-drawer__grip" aria-hidden="true"><span/></div>
        {children}
      </DrawerContent>
    </Drawer>
  );
}
