import { AuraMark, ICON } from '../../components/primitives';
import { ThemeToggle } from '../../components/ThemeToggle';

export function TopStrip({ djName, onOpenSearch, t, setTweak }) {
  return (
    <div className="aura-dh-topstrip">
      <div className="aura-dh-topstrip__brand">
        <AuraMark size={26}/>
        <span className="aura-dh-topstrip__wordmark">{djName}</span>
        {/* <span className="aura-dh-topstrip__tagline">captures your mood</span> */}
      </div>
      <div className="flex items-center gap-3">
        <button type="button" onClick={onOpenSearch} className="aura-dh-topstrip__search">
          <span className="text-ink-soft inline-flex">{ICON.search}</span>
          search
          <span className="aura-dh-topstrip__kbd">⌘K</span>
        </button>
        <ThemeToggle t={t} setTweak={setTweak}/>
      </div>
    </div>
  );
}
