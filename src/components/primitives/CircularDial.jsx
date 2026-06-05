import './CircularDial.css';

// SVG ring + centered label. Size, accent, track, progress are dynamic per
// call — SVG attributes already; not inline CSS style.
export function CircularDial({ size = 36, progress = 0, accent, track, stroke = 1.5, children }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div
      className="aura-circular-dial relative inline-flex items-center justify-center"
      style={{ '--size': `${size}px` }}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size/2} cy={size/2} r={r} stroke={track} strokeWidth={stroke} fill="none"/>
        <circle
          cx={size/2} cy={size/2} r={r}
          stroke={accent} strokeWidth={stroke} fill="none"
          strokeDasharray={c} strokeDashoffset={c * (1 - progress)} strokeLinecap="round"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">{children}</div>
    </div>
  );
}
