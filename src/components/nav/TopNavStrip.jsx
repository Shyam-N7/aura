import { ICON, AuraMark } from '../primitives';
import { ThemeToggle } from '../ThemeToggle';
import { AccountMenu } from './AccountMenu';
import './TopNavStrip.css';

const ITEMS = [
  { id: 'home',    label: 'home',     icon: ICON.home    },
  { id: 'search',  label: 'search',   icon: ICON.search  },
  { id: 'talk',    label: 'ask aura', talk: true,        icon: <TalkIcon/> },
  { id: 'library', label: 'library',  icon: ICON.you     },
  { id: 'journal', label: 'journal',  icon: ICON.journal },
  { id: 'dna',     label: 'dna',      icon: <DnaIcon/>   },
  { id: 'bridges', label: 'bridges',  icon: ICON.bridge  },
];

const HOME_STACK = new Set(['journal', 'dna', 'bridges', 'player', 'queue', 'playlists', 'playlist-detail', 'liked', 'catalog-playlist-detail', 'language-hub', 'artist']);

function TalkIcon() {
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

export function TopNavStrip({ djName = 'aura', active, onNav, onTalk, t, setTweak }) {
  return (
    <nav className="aura-top-nav">
      <div className="aura-top-nav__brand">
        <AuraMark/>
        <span className="aura-top-nav__brand-name">{djName.toLowerCase()}</span>
      </div>
      <div className="aura-top-nav__items">
        {ITEMS.map(it => {
          const on = it.talk
            ? false
            : (active === it.id || (it.id === 'home' && HOME_STACK.has(active)));
          const handle = it.talk ? onTalk : () => onNav(it.id);
          return (
            <button key={it.id} type="button" onClick={handle}
              className={`aura-top-nav__item ${on ? 'aura-top-nav__item--active' : ''}`}>
              <span className="aura-top-nav__item-icon">{it.icon}</span>
              {it.label}
            </button>
          );
        })}
      </div>
      <div className="aura-top-nav__right">
        <ThemeToggle t={t} setTweak={setTweak} className="aura-top-nav__theme"/>
        <AccountMenu placement="down"/>
      </div>
    </nav>
  );
}
