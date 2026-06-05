import { useEffect, useState } from 'react';
import { MonoLabel } from '../../components/primitives';
import { AuraLoader } from '../../components/feedback/AuraLoader';
import { getSonicDna } from '../../api/sonicDna';
import './DesktopDna.css';

// Desktop sonic-dna — radar + axes list + this-month stat cards + top moods.
// Real data from /api/sonic-dna.
export function DesktopDna() {
  const [hit, setHit] = useState({ data: null, error: null });
  const status = hit.error ? 'error' : hit.data ? 'ok' : 'loading';

  useEffect(() => {
    const ctl = new AbortController();
    getSonicDna({ signal: ctl.signal })
      .then(data => setHit({ data, error: null }))
      .catch(err => {
        if (err.name === 'AbortError') return;
        setHit({ data: null, error: err.message });
      });
    return () => ctl.abort();
  }, []);

  const dna = hit.data;

  return (
    <div className="aura-ddna">
      <div className="aura-ddna__header">
        <MonoLabel className="text-ink-faint" size={10}>
          sonic dna · a fingerprint of you
        </MonoLabel>
        <h1 className="aura-ddna__hero">
          You, as a<br/><em>fingerprint.</em>
        </h1>
        {dna?.signature && (
          <MonoLabel className="text-ink-faint mt-3.5 block" size={10}>
            {dna.signature}{dna.shift ? ` · ${dna.shift}` : ''}
          </MonoLabel>
        )}
      </div>

      <div className="aura-ddna__scroll">
        {status === 'loading' && (
          <AuraLoader label="Building your sonic DNA"/>
        )}

        {status === 'error' && (
          <div className="aura-ddna__error">
            Couldn’t load — {hit.error}
          </div>
        )}

        {status === 'ok' && !dna.available && (
          <div className="aura-ddna__empty">
            <div className="aura-ddna__empty-title">Not enough listening yet.</div>
            <div className="aura-ddna__empty-body">
              Play a few sessions before the fingerprint surfaces.
              {dna.threshold && dna.seen != null
                ? ` You’re at ${dna.seen}/${dna.threshold} plays so far.`
                : ''}
            </div>
          </div>
        )}

        {status === 'ok' && dna.available && (
          <>
            <div className="aura-ddna__radar-grid">
              <Radar axes={dna.axes ?? []} size={360}/>
              <div className="aura-ddna__axes">
                {(dna.axes ?? []).map((a, i) => (
                  <div key={i} className="aura-ddna__axis">
                    <div className="aura-ddna__axis-label">
                      <div className="aura-ddna__axis-name">{a.label}</div>
                      <MonoLabel className="text-ink-faint mt-1 block" size={9}>{a.range}</MonoLabel>
                    </div>
                    <div className="aura-ddna__axis-bar">
                      <div className="aura-ddna__axis-fill" style={{ width: `${(a.v ?? 0) * 100}%` }}/>
                    </div>
                    <MonoLabel className="text-ink-soft" size={10}>{Math.round((a.v ?? 0) * 100)}</MonoLabel>
                  </div>
                ))}
              </div>
            </div>

            {dna.thisMonth && (
              <div className="aura-ddna__month">
                <MonoLabel className="text-ink-faint block mb-[18px]" size={10}>this month · in numbers</MonoLabel>
                <div className="aura-ddna__stats">
                  <StatCard k="hours"   v={dna.thisMonth.hours     ?? '—'} sub="listened"/>
                  <StatCard k="artists" v={dna.thisMonth.artists   ?? '—'} sub="unique artists"/>
                  <StatCard k="new"     v={dna.thisMonth.newTracks ?? '—'} sub="new tracks"/>
                  <StatCard k="returns" v={dna.thisMonth.returns   ?? '—'} sub="returning"/>
                </div>
              </div>
            )}

            {dna.topMoods?.length > 0 && (
              <div className="aura-ddna__moods">
                <MonoLabel className="text-ink-faint block mb-[18px]" size={10}>top moods · this month</MonoLabel>
                <div className="aura-ddna__moods-row">
                  {dna.topMoods.map((m, i) => (
                    <div key={i} className="aura-ddna__mood" style={{ flex: m.share ?? 1 }}>
                      <div className="aura-ddna__mood-label">{m.label}</div>
                      <div className="aura-ddna__mood-share">{m.share}%</div>
                      <MonoLabel className="text-ink-faint mt-1 block" size={9}>share of week</MonoLabel>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function StatCard({ k, v, sub }) {
  return (
    <div className="aura-ddna__stat-card">
      <MonoLabel className="text-ink-faint" size={9}>{k}</MonoLabel>
      <div className="aura-ddna__stat-value">{v}</div>
      <MonoLabel className="text-ink-soft mt-3 block" size={10}>{sub}</MonoLabel>
    </div>
  );
}

function Radar({ axes, size = 360 }) {
  const n = axes.length;
  if (n < 3) return <div style={{ width: size, height: size }}/>;
  const r = size * 0.38;
  const cx = size / 2;
  const cy = size / 2;
  const pt = (i, v) => {
    const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
    return [cx + Math.cos(a) * r * v, cy + Math.sin(a) * r * v];
  };
  const userPath = axes.map((ax, i) => pt(i, ax.v ?? 0))
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`)
    .join(' ') + ' Z';
  return (
    <svg width={size} height={size} style={{ overflow: 'visible' }}>
      {[0.25, 0.5, 0.75, 1].map((s, i) => (
        <polygon key={i}
          points={axes.map((_, j) => pt(j, s).join(',')).join(' ')}
          stroke="var(--color-line)" strokeWidth="0.8" fill="none"/>
      ))}
      {axes.map((_, i) => {
        const [x, y] = pt(i, 1);
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y}
          stroke="var(--color-line)" strokeWidth="0.6"/>;
      })}
      <path d={userPath}
        fill="var(--color-accent)" fillOpacity="0.18"
        stroke="var(--color-accent)" strokeWidth="1.6"/>
      {axes.map((ax, i) => {
        const [x, y] = pt(i, ax.v ?? 0);
        return <circle key={i} cx={x} cy={y} r="4" fill="var(--color-accent)"/>;
      })}
      {axes.map((ax, i) => {
        const [x, y] = pt(i, 1.20);
        const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
        const cos = Math.cos(a);
        const anchor = cos < -0.3 ? 'end' : cos > 0.3 ? 'start' : 'middle';
        return (
          <text key={i} x={x} y={y} textAnchor={anchor} dominantBaseline="middle"
            style={{
              fontFamily: 'var(--font-sans)', fontWeight: 500, fontSize: 10,
              fill: 'var(--color-ink-soft)',
              letterSpacing: '0.08em', textTransform: 'uppercase',
            }}>
            {ax.label}
          </text>
        );
      })}
    </svg>
  );
}
