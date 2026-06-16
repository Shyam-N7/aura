import { useCallback } from 'react';
import './ThemeToggle.css';

// dusk (light) → midnight (dark) → bloom (pink) → dusk …
const NEXT = { dusk: 'midnight', midnight: 'bloom', bloom: 'dusk' };
// What the next click lands on — drives the action label.
const NEXT_LABEL = { dusk: 'dark', midnight: 'pink', bloom: 'light' };

// One inline switch that cycles light → dark → pink and back, swapping a
// sun / moon / blossom glyph as it goes. Lives next to the search affordance at
// every breakpoint. The full theme set (incl. direct selection) still lives in
// the Tweaks panel.
export function ThemeToggle({ t, setTweak, className = '' }) {
  const theme = NEXT[t.theme] ? t.theme : 'dusk';
  const cycle = useCallback(() => {
    setTweak('theme', NEXT[theme]);
  }, [theme, setTweak]);

  const label = `switch to ${NEXT_LABEL[theme]} theme`;
  return (
    <button
      type="button"
      className={`aura-theme-toggle aura-theme-toggle--${theme}${className ? ` ${className}` : ''}`}
      aria-label={label}
      title={label}
      onClick={cycle}
    >
      <svg className="aura-theme-toggle__icon" viewBox="0 0 24 24" aria-hidden="true">
        <g className="aura-theme-toggle__sun"
           fill="none" stroke="currentColor" strokeWidth="1.6"
           strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="4"/>
          <line x1="12" y1="2"     x2="12" y2="4"/>
          <line x1="12" y1="20"    x2="12" y2="22"/>
          <line x1="2"  y1="12"    x2="4"  y2="12"/>
          <line x1="20" y1="12"    x2="22" y2="12"/>
          <line x1="4.93"  y1="4.93"  x2="6.34"  y2="6.34"/>
          <line x1="17.66" y1="17.66" x2="19.07" y2="19.07"/>
          <line x1="4.93"  y1="19.07" x2="6.34"  y2="17.66"/>
          <line x1="17.66" y1="6.34"  x2="19.07" y2="4.93"/>
        </g>
        <path className="aura-theme-toggle__moon" fill="currentColor"
              d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
        {/* Blossom — five petal OUTLINES around a small centre, sketched in a
            fixed pink (line-art, no fill) so it matches the sun/moon and always
            reads as "the pink theme" regardless of the live palette. */}
        <g className="aura-theme-toggle__bloom"
           strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round">
          <ellipse cx="12" cy="6.6" rx="2" ry="4"/>
          <ellipse cx="12" cy="6.6" rx="2" ry="4" transform="rotate(72 12 12)"/>
          <ellipse cx="12" cy="6.6" rx="2" ry="4" transform="rotate(144 12 12)"/>
          <ellipse cx="12" cy="6.6" rx="2" ry="4" transform="rotate(216 12 12)"/>
          <ellipse cx="12" cy="6.6" rx="2" ry="4" transform="rotate(288 12 12)"/>
          <circle cx="12" cy="12" r="1.4"/>
        </g>
      </svg>
    </button>
  );
}
