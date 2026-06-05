import { useCallback } from 'react';
import './ThemeToggle.css';

// Inline button that toggles between dusk (light) and midnight (dark). Lives
// next to the search affordance at every breakpoint. Bloom remains reachable
// via the Tweaks panel; this toggle is intentionally binary.
export function ThemeToggle({ t, setTweak, className = '' }) {
  const isDark = t.theme === 'midnight';
  const onClick = useCallback(() => {
    setTweak('theme', isDark ? 'dusk' : 'midnight');
  }, [isDark, setTweak]);
  return (
    <button
      type="button"
      className={`aura-theme-toggle${isDark ? ' is-dark' : ''}${className ? ` ${className}` : ''}`}
      aria-pressed={isDark}
      aria-label={isDark ? 'switch to light mode' : 'switch to dark mode'}
      onClick={onClick}
    >
      <svg className="aura-theme-toggle__icon" viewBox="0 0 24 24"
           fill="none" stroke="currentColor" strokeWidth="1.6"
           strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <g className="aura-theme-toggle__sun">
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
        <path className="aura-theme-toggle__moon"
              d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
      </svg>
    </button>
  );
}
