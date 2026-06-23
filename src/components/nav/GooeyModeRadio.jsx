import './GooeyModeRadio.css';

// Gooey liquid radio for picking the listening mode — modes are mutually
// exclusive, so a radio group fits. A single accent "ball" liquid-slides between
// the mode dots through the #aura-goo-radio metaball filter, stretching between
// them as it moves (the gooey-liquid-radio look). Labels sit beside the dots and
// stay tappable. STEP must match the dot box height in GooeyModeRadio.css.
const STEP = 40;

export function GooeyModeRadio({ modes = [], activeMode = 'everyday', onSelect }) {
  const idx = Math.max(0, modes.findIndex(m => m.key === activeMode));
  return (
    <div className="aura-goomode" role="radiogroup" aria-label="Listening mode">
      <div className="aura-goomode__track">
        {modes.map((m, i) => (
          <button key={m.key} type="button" role="radio" aria-checked={i === idx}
            className={`aura-goomode__dot${i === idx ? ' is-active' : ''}`}
            aria-label={m.label} onClick={() => onSelect?.(m.key)}/>
        ))}
        <span className="aura-goomode__ball" aria-hidden="true"
          style={{ transform: `translateY(${idx * STEP}px)` }}/>
      </div>
      <div className="aura-goomode__labels">
        {modes.map((m, i) => (
          <button key={m.key} type="button"
            className={`aura-goomode__label${i === idx ? ' is-active' : ''}`}
            onClick={() => onSelect?.(m.key)}>{m.label}</button>
        ))}
      </div>
    </div>
  );
}
