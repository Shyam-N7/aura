import { useEffect, useState } from 'react';
import { MOOD_BRIDGES } from '../../data';
import { MonoLabel } from '../../components/primitives';
import { getBridge } from '../../api/bridges';
import { toast } from '../../lib/toast';
import { BridgeCard } from './BridgeCard';
import './DesktopBridges.css';

// Two DIFFERENT, plain word sets (each maps to a server MOOD_QUERIES bucket):
// "where you are" (a current feeling) and "where you want to be" (the goal).
// Colours tint the selected chip + the bridge arc.
const FROM_MOODS = [
  { key: 'sad',      hint: 'low, heavy',   color: '#5a6b9a' },
  { key: 'stressed', hint: 'wound up',     color: '#a85a5a' },
  { key: 'restless', hint: 'antsy, wired', color: '#c2603a' },
  { key: 'tired',    hint: 'drained',      color: '#7a6f8a' },
  { key: 'lonely',   hint: 'on your own',  color: '#5a7a8a' },
];
const TO_MOODS = [
  { key: 'happy',     hint: 'lifted',      color: '#d8956a' },
  { key: 'calm',      hint: 'at ease',     color: '#5a8a72' },
  { key: 'focused',   hint: 'locked in',   color: '#6e85a3' },
  { key: 'energized', hint: 'fired up',    color: '#c47554' },
  { key: 'social',    hint: 'out, lively', color: '#a8556a' },
];
const MIN_STEPS = 4;
const MAX_STEPS = 8;
const FROM_KEYS = FROM_MOODS.map(m => m.key);
const TO_KEYS = TO_MOODS.map(m => m.key);

// Last configured bridge persists per-device like the other aura.* prefs. The
// saved keys are validated against the CURRENT vocabulary — a cfg saved before
// the mood words changed (e.g. {from:'calm',to:'upbeat'}) would otherwise send
// an invalid mood to the server and 400 with "unknown mood".
function loadCfg() {
  try {
    const c = JSON.parse(localStorage.getItem('aura.moodBridge'));
    if (c && c.steps && FROM_KEYS.includes(c.from) && TO_KEYS.includes(c.to)) return c;
  } catch { /* ignore */ }
  return { from: 'sad', to: 'happy', steps: 5 };
}

export function DesktopBridges({ onPickSequence }) {
  const [loadingId, setLoadingId] = useState(null);
  const [cfg, setCfg] = useState(loadCfg);

  useEffect(() => {
    try { localStorage.setItem('aura.moodBridge', JSON.stringify(cfg)); }
    catch { /* localStorage disabled — non-fatal */ }
  }, [cfg]);

  const beginBridge = async (bridge) => {
    if (loadingId) return;
    setLoadingId(bridge.id);
    try {
      const { tracks } = await getBridge({ from: bridge.from, to: bridge.to, steps: bridge.steps });
      if (!tracks?.length) { toast('Couldn’t curate that bridge.'); return; }
      onPickSequence?.(tracks, 0, `${bridge.from} → ${bridge.to}`);
    } catch (err) {
      toast(`Couldn’t load bridge — ${err.message}`);
    } finally {
      setLoadingId(null);
    }
  };

  // The configured bridge, shaped like a preset so BridgeCard renders it. ETA is
  // a rough estimate (~3.5 min/track) just for display.
  const customBridge = {
    id: 'custom',
    from: cfg.from, to: cfg.to, steps: cfg.steps,
    ETA: `${Math.round(cfg.steps * 3.5)} min`,
    accent: '#7a3a1f',
  };
  const sameMood = cfg.from === cfg.to;

  return (
    <div className="aura-dbr">
      <div className="aura-dbr__header">
        <MonoLabel className="text-ink-faint" size={10}>
          gradual paths between feelings
        </MonoLabel>
        <h1 className="aura-dbr__hero">
          From here<br/><em>to there.</em>
        </h1>
        <p className="aura-dbr__sub">
          Songs threaded so the mood shifts gradually. Build your own path, or pick one below.
        </p>
      </div>

      {/* ─── Build your own ─────────────────────────────────────────────── */}
      <div className="aura-dbr__config">
        <MonoLabel className="text-ink-faint aura-dbr__config-label" size={10}>build your own</MonoLabel>
        <div className="aura-dbr__config-pick">
          <MoodPicker label="where you are" moods={FROM_MOODS} value={cfg.from}
            onPick={(k) => setCfg(c => ({ ...c, from: k }))}/>
          <MoodPicker label="where you want to be" moods={TO_MOODS} value={cfg.to}
            onPick={(k) => setCfg(c => ({ ...c, to: k }))}/>
        </div>

        <div className="aura-dbr__steps">
          <MonoLabel className="text-ink-faint" size={9}>length</MonoLabel>
          <button type="button" className="aura-dbr__steps-btn" aria-label="fewer tracks"
            disabled={cfg.steps <= MIN_STEPS}
            onClick={() => setCfg(c => ({ ...c, steps: Math.max(MIN_STEPS, c.steps - 1) }))}>−</button>
          <span className="aura-dbr__steps-val">{cfg.steps} tracks</span>
          <button type="button" className="aura-dbr__steps-btn" aria-label="more tracks"
            disabled={cfg.steps >= MAX_STEPS}
            onClick={() => setCfg(c => ({ ...c, steps: Math.min(MAX_STEPS, c.steps + 1) }))}>+</button>
        </div>

        {sameMood ? (
          <p className="aura-dbr__hint">Pick two different moods and AURA threads a path between them.</p>
        ) : (
          <div className={`aura-dbr__preview ${loadingId === 'custom' ? 'aura-dbr__loading' : ''}`}>
            <BridgeCard bridge={customBridge} idx={0} onClick={() => beginBridge(customBridge)}/>
            {loadingId === 'custom' && (
              <MonoLabel className="text-ink-faint mt-2 block text-center" size={9}>
                curating your bridge
              </MonoLabel>
            )}
          </div>
        )}
      </div>

      {/* ─── Suggested presets ──────────────────────────────────────────── */}
      <div className="aura-dbr__scroll">
        <MonoLabel className="text-ink-faint aura-dbr__presets-label" size={10}>
          or try a suggested path
        </MonoLabel>
        <div className="aura-dbr__grid">
          {MOOD_BRIDGES.map((b, i) => (
            <div key={b.id} className={loadingId === b.id ? 'aura-dbr__loading' : ''}>
              <BridgeCard bridge={b} idx={i} onClick={() => beginBridge(b)}/>
              {loadingId === b.id && (
                <MonoLabel className="text-ink-faint mt-2 block text-center" size={9}>
                  loading bridge
                </MonoLabel>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function MoodPicker({ label, moods, value, onPick }) {
  return (
    <div className="aura-dbr__moodcol">
      <MonoLabel className="text-ink-faint" size={9}>{label}</MonoLabel>
      <div className="aura-dbr__moodgrid">
        {moods.map(m => {
          const on = value === m.key;
          return (
            <button key={m.key} type="button" onClick={() => onPick(m.key)}
              className={`aura-dbr__moodchip ${on ? 'aura-dbr__moodchip--on' : ''}`}
              style={on ? { '--chip': m.color } : undefined}>
              <span className="aura-dbr__moodchip-key">{m.key}</span>
              <span className="aura-dbr__moodchip-hint">{m.hint}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
