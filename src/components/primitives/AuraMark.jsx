// Brand mark — two concentric rings that slowly breathe (animation lives in
// NavRail.css `aura-mark__ring--outer` / `--inner`) with a static accent core.
// Used in NavRail, TopNavStrip, OnboardingScreen brand row.
export function AuraMark({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 26 26" aria-hidden="true" className="aura-mark">
      <circle cx="13" cy="13" r="11.5" fill="none" stroke="currentColor" strokeWidth="0.7" opacity="0.35" className="aura-mark__ring aura-mark__ring--outer"/>
      <circle cx="13" cy="13" r="7"    fill="none" stroke="currentColor" strokeWidth="0.7" opacity="0.5"  className="aura-mark__ring aura-mark__ring--inner"/>
      <circle cx="13" cy="13" r="3"    fill="var(--color-accent)" className="aura-mark__core"/>
    </svg>
  );
}
