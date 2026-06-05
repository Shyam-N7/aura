// Subtler breathing dot — opacity-only pulse, no scale jitter. Color and size
// are dynamic per call (themed accent, one-off sizes). Static styling (display,
// border-radius, vertical-align, animation) goes through Tailwind.
export function BreathingDot({ color, size = 6, className = '', style }) {
  const dynStyle = {
    width: size,
    height: size,
    background: color,
    boxShadow: `0 0 0 2px ${color}1f`,
    ...style,
  };
  return (
    <span
      className={`inline-block rounded-full align-middle animate-aura-soft ${className}`}
      style={dynStyle}
    />
  );
}
