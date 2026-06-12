import { useEffect, useState } from 'react';
import { MonoLabel, BreathingDot, ICON, AuraMark } from '../primitives';
import { ProfileButton } from './ProfileButton';
import { getCurrentMood } from '../../api/mood';
import './NavRail.css';

const LISTEN = [
  { id: 'home',    label: 'home',    icon: ICON.home    },
  { id: 'search',  label: 'search',  icon: ICON.search  },
  { id: 'talk',    label: 'ask aura', icon: <TalkIcon/>  },
  { id: 'library', label: 'library', icon: ICON.you     },
];

const STUDY = [
  { id: 'journal', label: 'journal',    icon: ICON.journal },
  { id: 'dna',     label: 'sonic dna',  icon: <DnaIcon/>   },
  { id: 'bridges', label: 'bridges',    icon: ICON.bridge  },
];

const HOME_STACK = new Set(['journal', 'dna', 'bridges', 'player', 'queue', 'playlists', 'playlist-detail', 'liked', 'catalog-playlist-detail', 'language-hub']);

function TalkIcon() {
  // Rounded speech bubble with three conversation dots — universally legible
  // as "chat" at 16px.
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2.2 3.5 a1.5 1.5 0 0 1 1.5 -1.5 h8.6 a1.5 1.5 0 0 1 1.5 1.5 v6 a1.5 1.5 0 0 1 -1.5 1.5 h-5.4 l-3.2 2.6 v-2.6 h-0 a1.5 1.5 0 0 1 -1.5 -1.5 z"
        stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
      <circle cx="5.5"  cy="6.7" r="0.95" fill="currentColor"/>
      <circle cx="8"    cy="6.7" r="0.95" fill="currentColor"/>
      <circle cx="10.5" cy="6.7" r="0.95" fill="currentColor"/>
    </svg>
  );
}

function DnaIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3 2 Q8 8 3 14 M13 2 Q8 8 13 14" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
    </svg>
  );
}

// Soft, conversational freshness — matches AURA's lowercase voice and avoids
// the "32m ago" data-stamp feel. Rounds to humanish chunks (half-hour, an
// hour) where the precision doesn't matter.
function softTime(ts) {
  if (!ts) return 'just now';
  const sec = Math.round((Date.now() - Number(ts)) / 1000);
  if (sec < 30)         return 'just now';
  if (sec < 90)         return 'a min back';
  const m = Math.round(sec / 60);
  if (m < 5)            return 'a few mins back';
  if (m < 25)           return `${m} mins back`;
  if (m < 40)           return 'half an hour back';
  if (m < 80)           return 'an hour back';
  if (m < 60 * 5)       return `${Math.round(m / 60)} hrs back`;
  if (m < 60 * 24)      return 'earlier today';
  const d = Math.round(m / (60 * 24));
  if (d < 2)            return 'yesterday';
  if (d < 7)            return `${d} days back`;
  return 'a while back';
}

export function NavRail({ djName = 'aura', mood, active, onNav, collapsed = false, onToggle }) {
  const [snapshot, setSnapshot] = useState(null);
  useEffect(() => {
    const ctl = new AbortController();
    getCurrentMood({ signal: ctl.signal }).then(setSnapshot).catch(() => {});
    return () => ctl.abort();
  }, []);
  const inferred  = snapshot?.mood && snapshot.confidence >= 0.5;
  const liveMood  = inferred ? snapshot.mood : mood;
  const updatedAt = snapshot?.ts ? softTime(snapshot.ts) : null;
  const confidence = inferred ? snapshot.confidence : null;
  const drift      = inferred ? snapshot.drift : null;
  const reason     = inferred ? snapshot.reason : null;

  return (
    <aside className={`aura-nav-rail ${collapsed ? 'aura-nav-rail--collapsed' : ''}`}>
      {/* expand toggle — bookmark sticking out the right edge when collapsed */}
      {onToggle && collapsed && (
        <button onClick={onToggle} aria-label="expand nav" className="aura-nav-rail__bookmark">
          <Chevron direction="right"/>
        </button>
      )}

      {/* brand */}
      <div className="aura-nav-rail__brand">
        <span className="aura-nav-rail__mark text-ink"><AuraMark/></span>
        {!collapsed && <span className="aura-nav-rail__brand-name">{djName.toLowerCase()}</span>}
        {onToggle && !collapsed && (
          <button onClick={onToggle} aria-label="collapse nav"
            className="aura-nav-rail__collapse-btn aura-nav-rail__collapse-btn--inline">
            <Chevron direction="left"/>
          </button>
        )}
      </div>

      {/* primary nav — listen */}
      <NavSection label="listen" collapsed={collapsed}>
        {LISTEN.map(it => (
          <NavItem key={it.id} {...it} collapsed={collapsed} tourId={`nav-${it.id}`}
            active={active === it.id || (it.id === 'home' && HOME_STACK.has(active))}
            onClick={() => onNav(it.id)}/>
        ))}
      </NavSection>

      {/* study */}
      <NavSection label="study" collapsed={collapsed} tourId="nav-study">
        {STUDY.map(it => (
          <NavItem key={it.id} {...it} collapsed={collapsed} tourId={`nav-${it.id}`}
            active={active === it.id}
            onClick={() => onNav(it.id)}/>
        ))}
      </NavSection>

      <div className="flex-1"/>

      {/* signal — AURA's current read (hidden when collapsed). Mood drives an
          ambient color wash and a drift glyph (↗ warming, → steady, ↘ cooling);
          confidence is the thin bar; events_seen contextualises the freshness. */}
      {!collapsed && (
        <div className={`aura-nav-rail__signal ${liveMood ? `aura-nav-rail__signal--${liveMood}` : ''}`}>
          <div className="aura-nav-rail__signal-head">
            <BreathingDot color="var(--mood-color, var(--color-accent))"/>
            <MonoLabel className="text-ink-faint" size={8.5}>
              {inferred ? 'reading you' : 'from settings'}
            </MonoLabel>
          </div>
          <div className="aura-nav-rail__signal-mood">
            <span>{liveMood ?? '—'}</span>
            {drift && <DriftGlyph drift={drift}/>}
          </div>
          {reason && <div className="aura-nav-rail__signal-reason">{reason}</div>}
          {confidence != null && (
            <div className="aura-nav-rail__signal-bar"
              aria-label={`confidence ${Math.round(confidence * 100)} percent`}>
              <span className="aura-nav-rail__signal-bar-fill"
                style={{ '--c': confidence }}/>
            </div>
          )}
          <MonoLabel className="aura-nav-rail__signal-foot text-ink-faint" size={8.5}>
            {inferred
              ? `from your last 30 · ${updatedAt}`
              : updatedAt
                ? `picked in tweaks · ${updatedAt}`
                : 'picked in tweaks'}
          </MonoLabel>
        </div>
      )}

      {/* identity row — "this is you → your library"; account actions live in
          Settings (gear inside the library header) */}
      <div className="aura-nav-rail__account">
        <ProfileButton variant="row" collapsed={collapsed} onClick={() => onNav('library')}/>
      </div>
    </aside>
  );
}

function Chevron({ direction }) {
  const d = direction === 'left' ? 'M7 1 L2 5 L7 9' : 'M2 1 L7 5 L2 9';
  return (
    <svg width="9" height="10" viewBox="0 0 9 10" aria-hidden="true">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
    </svg>
  );
}

function NavSection({ label, collapsed, children, tourId }) {
  return (
    <div className="aura-nav-rail__section" data-tour={tourId}>
      {!collapsed && (
        <div className="aura-nav-rail__section-label">
          <MonoLabel className="text-ink-faint" size={8.5}>{label}</MonoLabel>
        </div>
      )}
      {children}
    </div>
  );
}

function DriftGlyph({ drift }) {
  if (drift !== 'warming' && drift !== 'cooling') return null;
  const rot = drift === 'warming' ? -38 : 38;
  return (
    <svg className="aura-nav-rail__signal-drift" width="14" height="14" viewBox="0 0 14 14"
      style={{ transform: `rotate(${rot}deg)` }} aria-hidden="true">
      <path d="M2.5 7 H11 M7.2 3 L11 7 L7.2 11"
        fill="none" stroke="currentColor" strokeWidth="1.6"
        strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function NavItem({ icon, label, active, onClick, collapsed, tourId }) {
  return (
    <button onClick={onClick} title={collapsed ? label : undefined}
      data-tour={tourId}
      className={`aura-nav-rail__item ${collapsed ? 'aura-nav-rail__item--icon' : ''} ${active ? 'aura-nav-rail__item--active' : ''}`}>
      <span className="aura-nav-rail__item-icon">{icon}</span>
      {!collapsed && label}
    </button>
  );
}
