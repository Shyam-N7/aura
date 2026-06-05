// Player transport icons — repeat (off/all/one) + shuffle. Extracted from the
// retired mobile PlayerScreen so the live DesktopRail keeps a home for them.

// Repeat-mode glyph. 18×18. Off/All share the same circular-arrow path;
// One adds a small `1` inside the loop.
export function RepeatIcon({ mode }) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M4 6 H12 L10 4 M14 12 H6 L8 14"
        stroke="currentColor" strokeWidth="1.4"
        strokeLinecap="round" strokeLinejoin="round"/>
      {mode === 'one' && (
        <text x="9" y="11.5" textAnchor="middle"
          fontFamily="var(--font-mono)" fontSize="6.5" fontWeight="600"
          fill="currentColor">1</text>
      )}
    </svg>
  );
}

// Shuffle glyph. 18×18. Two crossing paths with arrowheads — the standard
// shuffle mark used by Spotify/Tidal/Apple.
export function ShuffleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M2 5 H5 L11 13 H14 M12 11 L14 13 L12 15"
        stroke="currentColor" strokeWidth="1.4"
        strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M2 13 H5 L7.5 10 M12 7 L14 5 L12 3 M10.5 7.5 L11 8 M14 5 H11"
        stroke="currentColor" strokeWidth="1.4"
        strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}
