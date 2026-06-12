import './RotateOverlay.css';

// Full-screen prompt for phones held in landscape (see classifyViewport in
// useViewport.js). The app — forced to the portrait mobile layout — stays
// mounted underneath, so the music keeps playing and rotating back restores
// everything instantly. z-index 1000 out-paints every overlay in the app
// (player drawer 41, dialogs 50, lyrics 51, EQ 80).
export function RotateOverlay() {
  return (
    <div className="aura-rotate" role="status">
      <svg className="aura-rotate__glyph" width="44" height="44" viewBox="0 0 44 44" fill="none" aria-hidden="true">
        <rect x="13" y="6" width="18" height="32" rx="4" stroke="currentColor" strokeWidth="2"/>
        <circle cx="22" cy="33" r="1.6" fill="currentColor"/>
      </svg>
      <div className="aura-rotate__title">turn your phone upright</div>
      <div className="aura-rotate__sub">aura is made for portrait — your music keeps playing.</div>
    </div>
  );
}
