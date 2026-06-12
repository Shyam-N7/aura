import { useEffect, useState } from 'react';
import { MOOD_BRIDGES } from '../../data';
import { MonoLabel } from '../../components/primitives';
import { getBridge, getBridgeSuggestion } from '../../api/bridges';
import { toast } from '../../lib/toast';
import { BridgeCard } from './BridgeCard';
import { BridgeItinerary } from './BridgeItinerary';
import { FROM_MOODS, TO_MOODS, BRIDGE_LANGS, MIN_STEPS, MAX_STEPS, loadCfg, saveCfg } from './bridgeCfg';
import './DesktopBridges.css';

export function DesktopBridges({ onPickSequence }) {
  const [cfg, setCfg] = useState(loadCfg);
  const [loadingId, setLoadingId] = useState(null);     // preset one-tap builds
  // The clairvoyant hero: suggest is instant (no LLM); the build prefetches in
  // the background so the arc fills with real album art before any tap.
  const [suggestion, setSuggestion] = useState(null);
  const [suggestGone, setSuggestGone] = useState(false);
  const [heroBridge, setHeroBridge] = useState(null);   // { narrative, tracks }
  // Builder is two-phase: curate (LLM plan + tracks) → begin.
  const [built, setBuilt] = useState(null);             // { narrative, tracks }
  const [building, setBuilding] = useState(false);

  useEffect(() => saveCfg(cfg), [cfg]);

  useEffect(() => {
    const ctl = new AbortController();
    (async () => {
      try {
        const s = await getBridgeSuggestion({ signal: ctl.signal });
        setSuggestion(s);
        const b = await getBridge({
          from: s.from, to: s.to, steps: s.steps ?? 5, langs: s.langs ?? [], signal: ctl.signal,
        });
        if (b.tracks?.length) setHeroBridge(b);
      } catch {
        // No read / signed-out edge / network: the builder leads instead.
        setSuggestGone(true);
      }
    })();
    return () => ctl.abort();
  }, []);

  const play = (tracks, from, to, el) => onPickSequence?.(tracks, 0, `${from} → ${to}`, el);

  const beginHero = (el) => {
    if (heroBridge?.tracks?.length && suggestion) play(heroBridge.tracks, suggestion.from, suggestion.to, el);
  };

  const curate = async () => {
    if (building) return;
    setBuilding(true);
    try {
      const b = await getBridge({ from: cfg.from, to: cfg.to, steps: cfg.steps, langs: cfg.langs });
      if (!b.tracks?.length) { toast('couldn’t curate that bridge.'); return; }
      setBuilt(b);
    } catch (err) {
      toast(`couldn’t curate — ${err.message}`);
    } finally {
      setBuilding(false);
    }
  };
  const beginBuilt = (el) => { if (built?.tracks?.length) play(built.tracks, cfg.from, cfg.to, el); };

  // Any cfg change invalidates the curated itinerary back to the plain preview.
  const updateCfg = (patch) => { setBuilt(null); setCfg(c => ({ ...c, ...patch })); };
  const toggleLang = (l) => {
    setBuilt(null);
    setCfg(c => {
      if (l === 'mix') return { ...c, langs: [] };
      if (c.langs.includes(l)) return { ...c, langs: c.langs.filter(x => x !== l) };
      return { ...c, langs: [...c.langs, l].slice(-2) };   // third pick replaces the oldest
    });
  };

  // Presets honor the language chips too — classic paths, your languages.
  const beginPreset = async (bridge) => {
    if (loadingId) return;
    setLoadingId(bridge.id);
    try {
      const { tracks } = await getBridge({ from: bridge.from, to: bridge.to, steps: bridge.steps, langs: cfg.langs });
      if (!tracks?.length) { toast('couldn’t curate that bridge.'); return; }
      play(tracks, bridge.from, bridge.to);
    } catch (err) {
      toast(`couldn’t load bridge — ${err.message}`);
    } finally {
      setLoadingId(null);
    }
  };

  const sameMood = cfg.from === cfg.to;
  const customBridge = { id: 'custom', from: cfg.from, to: cfg.to, steps: cfg.steps };

  return (
    <div className="aura-dbr">
      <div className="aura-dbr__header">
        <MonoLabel className="text-ink-faint" size={14}>
          gradual paths between feelings
        </MonoLabel>
        <h1 className="aura-dbr__hero">
          From here<br/><em>to there.</em>
        </h1>
        <p className="aura-dbr__sub">
          songs threaded so the mood shifts gradually. build your own path, or let the bridge read you.
        </p>
      </div>

      {/* ─── The clairvoyant hero ───────────────────────────────────────── */}
      {!suggestGone && (
        <section className="aura-dbr-hero">
          <MonoLabel className="text-accent aura-dbr-hero__tag" size={12}>
            the bridge already knows
          </MonoLabel>
          {suggestion ? (
            <>
              <p className="aura-dbr-hero__reason">{suggestion.reason}</p>
              <div className="aura-dbr-hero__card">
                <BridgeItinerary
                  bridge={{ id: 'hero', from: suggestion.from, to: suggestion.to, steps: suggestion.steps ?? 5 }}
                  tracks={heroBridge?.tracks}
                  narrative={heroBridge?.narrative}
                  loading={!heroBridge}
                  cta={heroBridge?.tracks?.length ? { label: 'begin →', onClick: beginHero } : null}/>
              </div>
            </>
          ) : (
            <div className="aura-dbr-hero__shimmer" aria-hidden="true"/>
          )}
        </section>
      )}

      {/* ─── Build your own ─────────────────────────────────────────────── */}
      <div className="aura-dbr__config">
        <MonoLabel className="text-ink-faint aura-dbr__config-label" size={16}>build your own</MonoLabel>
        <div className="aura-dbr__config-pick">
          <MoodPicker label="where you are" moods={FROM_MOODS} value={cfg.from}
            badgeKey={suggestion?.mood ? suggestion.from : null}
            onPick={(k) => updateCfg({ from: k })}/>
          <MoodPicker label="where you want to be" moods={TO_MOODS} value={cfg.to}
            onPick={(k) => updateCfg({ to: k })}/>
        </div>

        <div className="aura-dbr__langs">
          <MonoLabel className="text-ink-faint" size={16}>languages</MonoLabel>
          <div className="aura-dbr__langrow">
            <button type="button" onClick={() => toggleLang('mix')}
              className={`aura-dbr__langchip ${cfg.langs.length === 0 ? 'aura-dbr__langchip--on' : ''}`}>
              your mix
            </button>
            {BRIDGE_LANGS.map(l => (
              <button key={l} type="button" onClick={() => toggleLang(l)}
                className={`aura-dbr__langchip ${cfg.langs.includes(l) ? 'aura-dbr__langchip--on' : ''}`}>
                {l}
              </button>
            ))}
          </div>
        </div>

        <div className="aura-dbr__steps">
          <MonoLabel className="text-ink-faint" size={12}>length</MonoLabel>
          <button type="button" className="aura-dbr__steps-btn" aria-label="fewer tracks"
            disabled={cfg.steps <= MIN_STEPS}
            onClick={() => updateCfg({ steps: Math.max(MIN_STEPS, cfg.steps - 1) })}>−</button>
          <span className="aura-dbr__steps-val">{cfg.steps} tracks</span>
          <button type="button" className="aura-dbr__steps-btn" aria-label="more tracks"
            disabled={cfg.steps >= MAX_STEPS}
            onClick={() => updateCfg({ steps: Math.min(MAX_STEPS, cfg.steps + 1) })}>+</button>
        </div>

        {sameMood ? (
          <p className="aura-dbr__hint">pick two different moods and aura threads a path between them.</p>
        ) : (
          <div className="aura-dbr__preview">
            <BridgeItinerary
              bridge={customBridge}
              tracks={built?.tracks}
              narrative={built?.narrative}
              loading={building}
              cta={building ? null
                : built?.tracks?.length
                  ? { label: 'begin →', onClick: beginBuilt }
                  : { label: 'curate this path →', onClick: curate }}/>
          </div>
        )}
      </div>

      {/* ─── Classic paths ──────────────────────────────────────────────── */}
      <div className="aura-dbr__scroll">
        <MonoLabel className="text-ink-faint aura-dbr__presets-label" size={16}>
          classic paths
        </MonoLabel>
        <div className="aura-dbr__grid">
          {MOOD_BRIDGES.map((b, i) => (
            <div key={b.id} className={loadingId === b.id ? 'aura-dbr__loading' : ''}>
              <BridgeCard bridge={b} idx={i} onClick={() => beginPreset(b)}/>
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

function MoodPicker({ label, moods, value, onPick, badgeKey = null }) {
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
              <span className="aura-dbr__moodchip-key">
                {m.key}
                {badgeKey === m.key && <span className="aura-dbr__moodchip-badge">you</span>}
              </span>
              <span className="aura-dbr__moodchip-hint">{m.hint}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
