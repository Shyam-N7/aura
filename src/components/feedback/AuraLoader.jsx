import { BreathingDot } from '../primitives';
import './AuraLoader.css';

export function AuraLoader({ label, centered = true }) {
  return (
    <div className={`aura-loader ${centered ? 'aura-loader--centered' : ''}`}>
      <div className="aura-loader__visual" aria-hidden="true">
        <span className="aura-loader__ring"/>
        <span className="aura-loader__ring aura-loader__ring--late"/>
        <BreathingDot color="var(--color-accent)" size={8}/>
      </div>
      {label && <div className="aura-loader__label">{label}</div>}
    </div>
  );
}
