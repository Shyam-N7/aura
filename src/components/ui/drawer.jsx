import { Drawer as Vaul } from 'vaul';
import { cn } from '../../lib/cn';
import './drawer.css';

// AURA-skinned vaul Drawer. We deliberately hand-add this primitive (rather than
// `npx shadcn init`, which assumes a v3 tailwind.config + HSL token convention)
// so it coexists with the app's Tailwind v4 `@theme` tokens. The whole app is
// portaled into `.aura-responsive-shell`; vaul portals to <body> by default, so
// we pin the portal back into the shell — that keeps the overlay's absolute
// positioning, the theme class, and the z-index stack correct.

function shellContainer() {
  if (typeof document === 'undefined') return undefined;
  return document.querySelector('.aura-responsive-shell') ?? undefined;
}

export const Drawer = (props) => <Vaul.Root {...props}/>;
export const DrawerClose = Vaul.Close;
export const DrawerTitle = Vaul.Title;
export const DrawerDescription = Vaul.Description;

// Visually-hidden title — Radix Dialog (vaul's base) warns without one. Use when
// the sheet has no visible heading of its own.
export function DrawerSrTitle({ children }) {
  return <Vaul.Title className="aura-drawer__sr-title">{children}</Vaul.Title>;
}

export function DrawerContent({ className, children, showHandle = true, overlayClassName, ...props }) {
  return (
    <Vaul.Portal container={shellContainer()}>
      <Vaul.Overlay className={cn('aura-drawer__overlay', overlayClassName)}/>
      <Vaul.Content className={cn('aura-drawer__content', className)} {...props}>
        {showHandle && <div className="aura-drawer__handle" aria-hidden="true"/>}
        {children}
      </Vaul.Content>
    </Vaul.Portal>
  );
}
