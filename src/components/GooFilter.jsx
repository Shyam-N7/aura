import './GooFilter.css';

// Shared SVG "goo" filter (metaball: blur → alpha threshold → composite) for the
// liquid-glass chrome morphs. Rendered once near the app root; referenced via
// `filter: url(#aura-goo)`. Deliberately kept OFF the glass surfaces themselves —
// `filter` and `backdrop-filter` fight — so it rides a contents layer and is
// toggled on only for the duration of a morph (see the mobile bar/top-bar CSS).
export function GooFilter() {
  return (
    <svg className="aura-goo-defs" width="0" height="0" aria-hidden="true" focusable="false">
      <defs>
        {/* Subtle — content melt during the bottom-bar morph. */}
        <filter id="aura-goo" colorInterpolationFilters="sRGB">
          <feGaussianBlur in="SourceGraphic" stdDeviation="5" result="blur"/>
          <feColorMatrix in="blur" type="matrix"
            values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 19 -8" result="goo"/>
          <feComposite in="SourceGraphic" in2="goo" operator="atop"/>
        </filter>
      </defs>
    </svg>
  );
}
