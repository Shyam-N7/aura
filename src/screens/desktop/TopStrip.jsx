import { MonoLabel, AuraMark, ICON } from '../../components/primitives';
import { useNow, formatShortStamp } from '../../hooks/useNow';
import { ThemeToggle } from '../../components/ThemeToggle';

export function TopStrip({ djName, onOpenSearch, t, setTweak }) {
  const now = useNow();
  return (
    <div className="aura-dh-topstrip">
      <div className="inline-flex items-center gap-2.5 text-ink-soft">
        <AuraMark size={16}/>
        <MonoLabel className="text-ink-soft">
          {djName} · {formatShortStamp(now).toLowerCase()}
        </MonoLabel>
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
