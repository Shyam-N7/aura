import { useState } from 'react';
import { AuraMark, ICON } from '../../components/primitives';
import { ThemeToggle } from '../../components/ThemeToggle';
import { AnchoredMenu } from '../../components/AnchoredMenu';
import { GooeyModeRadio } from '../../components/nav/GooeyModeRadio';

export function TopStrip({ djName, onOpenSearch, t, setTweak, activeMode = 'everyday', modes = [], onSetMode }) {
  // Listening-mode switcher (desktop) — mirrors the mobile chip. anchorEl in state
  // per the AnchoredMenu contract.
  const [modeMenuEl, setModeMenuEl] = useState(null);
  const activeLabel = modes.find(m => m.key === activeMode)?.label ?? 'Everyday';
  return (
    <div className="aura-dh-topstrip">
      <div className="aura-dh-topstrip__brand">
        <AuraMark size={26}/>
        <span className="aura-dh-topstrip__wordmark">{djName}</span>
        {/* <span className="aura-dh-topstrip__tagline">captures your mood</span> */}
      </div>
      <div className="flex items-center gap-3">
        {onSetMode && modes.length > 0 && (
          <button type="button" className="aura-dh-topstrip__mode"
            onClick={(e) => { const el = e.currentTarget; setModeMenuEl(prev => (prev ? null : el)); }}
            aria-haspopup="menu" aria-label={`Listening mode: ${activeLabel}`}>
            {activeLabel}
          </button>
        )}
        <button type="button" onClick={onOpenSearch} className="aura-dh-topstrip__search">
          <span className="text-ink-soft inline-flex">{ICON.search}</span>
          search
          <span className="aura-dh-topstrip__kbd">⌘K</span>
        </button>
        <ThemeToggle t={t} setTweak={setTweak}/>
      </div>
      {modeMenuEl && (
        <AnchoredMenu anchorEl={modeMenuEl} onClose={() => setModeMenuEl(null)} className="aura-pl-menu--goo">
          {/* Keep the menu open on select so the liquid ball-slide is visible;
              outside-click / Esc closes it. */}
          <GooeyModeRadio modes={modes} activeMode={activeMode} onSelect={(k) => onSetMode?.(k)}/>
        </AnchoredMenu>
      )}
    </div>
  );
}
