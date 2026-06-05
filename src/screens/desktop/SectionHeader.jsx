import { MonoLabel } from '../../components/primitives';

export function SectionHeader({ title, sub, onMore, large }) {
  return (
    <div className={`aura-dh-section-header ${large ? 'aura-dh-section-header--large' : ''}`}>
      <div>
        <div className="aura-dh-section-header__title">{title}</div>
        {sub && <MonoLabel className="text-ink-faint mt-2 block" size={9}>{sub}</MonoLabel>}
      </div>
      {onMore && (
        <button onClick={onMore} className="aura-dh-section-header__more">SEE ALL →</button>
      )}
    </div>
  );
}
