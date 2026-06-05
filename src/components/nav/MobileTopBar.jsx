import { AuraMark, MonoLabel } from '../primitives';
import { ThemeToggle } from '../ThemeToggle';
import { AccountMenu } from './AccountMenu';
import { useNow, formatShortStamp } from '../../hooks/useNow';
import './MobileTopBar.css';

// Mobile-only top pill — mirrors MobileBottomBar's glass-pill recipe at the
// top of the viewport. AuraMark + djName + short stamp on the left, theme
// toggle + account avatar on the right. Replaces DesktopHome's sticky TopStrip
// on mobile. `showAccount` is false during onboarding (no ConfirmDialog mounted
// there, so the sign-out confirm couldn't render).
export function MobileTopBar({ djName = 'aura', t, setTweak, showAccount = true }) {
  const now = useNow();
  return (
    <div className="aura-mobile-top">
      <div className="aura-mobile-top__brand">
        <AuraMark size={16}/>
        <MonoLabel className="text-ink-soft">
          {djName} · {formatShortStamp(now).toLowerCase()}
        </MonoLabel>
      </div>
      <div className="aura-mobile-top__right">
        <ThemeToggle t={t} setTweak={setTweak} className="aura-mobile-top__theme"/>
        {showAccount && <AccountMenu placement="down"/>}
      </div>
    </div>
  );
}
