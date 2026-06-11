import { Drawer, DrawerContent, DrawerSrTitle } from '../ui/drawer';
import './PlayerDrawer.css';

// Full-height now-playing drawer for phones: pull it DOWN to minimise back to the
// mini bar (vaul owns the drag + slide). `screen === 'player'` stays the source
// of truth — `open` is derived from it and a dismiss calls onClose (leavePlayer),
// which flips the screen and lets vaul animate the slide-out. Desktop/tablet keep
// the routed player; only true-mobile gets the gesture.
export function PlayerDrawer({ open, onClose, children }) {
  return (
    <Drawer open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DrawerContent
        className="aura-player-drawer"
        overlayClassName="aura-player-drawer__overlay"
        showHandle={false}>
        <DrawerSrTitle>Now playing</DrawerSrTitle>
        <div className="aura-player-drawer__grip" aria-hidden="true"><span/></div>
        {children}
      </DrawerContent>
    </Drawer>
  );
}
