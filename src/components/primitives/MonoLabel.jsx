// Sans-serif eyebrow label, all-caps with 0.08em tracking. The default register
// for section headers, meta strings, and chrome labels across the app.
//
// `numeric` opt-in switches to the .aura-numeric utility (Hanken Grotesk with
// tabular-nums OpenType feature) for digit columns that need row-to-row
// alignment (duration columns in queue / playlist detail).
export function MonoLabel({ children, color, size = 9.5, className = '', style, numeric = false }) {
  const dynStyle = { fontSize: size, ...(color ? { color } : null), ...style };
  const cls = numeric
    ? `aura-numeric uppercase tracking-[0.04em] leading-[1.2] ${className}`
    : `font-sans font-medium uppercase tracking-[0.08em] leading-[1.2] ${className}`;
  return (
    <span className={cls} style={dynStyle}>
      {children}
    </span>
  );
}
