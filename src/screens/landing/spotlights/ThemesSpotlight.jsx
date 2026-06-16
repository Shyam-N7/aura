import { useState } from 'react';
import { THEMES } from '../../../data/themes';
import { BridgeItinerary } from '../../desktop/BridgeItinerary';
import { BRIDGE_PRESETS, THEME_DEMO_TRACK, cover } from '../showcaseData';
import { chipPop } from '../useGsap';
import '../../desktop/DesktopBridges.css';

// Spotlight: live theming. The pills scope a real `.theme-*` class onto the
// preview cluster, so the genuine --color-* tokens cascade onto real components
// (a now-playing card + a bridge arc) and re-theme in real time.
export function ThemesSpotlight() {
  const [theme, setTheme] = useState('dusk');
  const b = BRIDGE_PRESETS[0];
  return (
    <div className="lp-themes">
      <div className="lp-themes__pills">
        {Object.keys(THEMES).map((id) => (
          <button key={id} type="button"
            className={`lp-chip${theme === id ? ' is-on' : ''}`}
            aria-pressed={theme === id}
            onClick={(e) => { chipPop(e.currentTarget); setTheme(id); }}>
            <span className="lp-themes__swatch" aria-hidden="true" style={{ background: THEMES[id].bg }}>
              <span style={{ background: THEMES[id].accent }}/>
            </span>
            {id}
          </button>
        ))}
      </div>

      <div className={`theme-${theme} lp-themes__preview`}>
        <div className="lp-np">
          <div className="lp-np__cover" style={{ backgroundImage: `url("${cover(...THEME_DEMO_TRACK.cover)}")` }}/>
          <div className="lp-np__meta">
            <div className="lp-np__title">{THEME_DEMO_TRACK.title}</div>
            <div className="lp-np__artist">{THEME_DEMO_TRACK.artist}</div>
          </div>
          <span className="lp-np__dot" aria-hidden="true"/>
        </div>
        <div className="lp-themes__card">
          <BridgeItinerary
            bridge={{ id: 'lp-theme', from: b.from, to: b.to, steps: b.steps }}
            tracks={b.tracks}
            narrative={b.narrative}
          />
        </div>
      </div>
    </div>
  );
}
