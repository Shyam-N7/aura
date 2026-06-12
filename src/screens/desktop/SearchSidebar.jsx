import { MonoLabel } from '../../components/primitives';
import { useRecentSearches } from '../../hooks/useRecentSearches';

const TRENDING_BY_LANG = {
  all:       ['halcyon', 'a.r. rahman', 'sid sriram', 'lana del rey', 'arijit singh', 'phir bhi tumko chaahunga'],
  tamil:     ['vaaranam aayiram', 'anirudh', 'sid sriram', 'thalapathy', 'jana nayagan', 'ar rahman tamil'],
  english:   ['halcyon', 'lana del rey', 'hozier', 'ellie goulding', 'taylor swift', 'phoebe bridgers'],
  hindi:     ['arijit singh', 'ar rahman hindi', 'pritam', 'lata mangeshkar', 'tu hi hai aashiqui', 'kal ho na ho'],
  malayalam: ['malayalam hits', 'shaan rahman', 'gopi sundar', 'sushin shyam', 'malayalam classics', 'kj yesudas'],
  kannada:   ['kannada hits', 'raghu dixit', 'arjun janya', 'sanjith hegde', 'sonu nigam kannada', 'k.j. yesudas'],
};

export function SearchSidebar({ lang = 'all', onPick }) {
  const { items: recents, clear } = useRecentSearches();
  const trending = TRENDING_BY_LANG[lang] ?? TRENDING_BY_LANG.all;

  return (
    <aside className="aura-dse__sidebar">
      <section className="aura-dse__sidebar-section">
        <div className="flex items-baseline justify-between mb-2">
          <MonoLabel className="aura-dse__sidebar-heading" size={16}>recent</MonoLabel>
          {recents.length > 0 && (
            <button onClick={clear} className="aura-dse__sidebar-clear">clear</button>
          )}
        </div>
        {recents.length === 0 ? (
          <div className="font-serif italic text-[13px] text-ink-faint">
            your searches will show up here.
          </div>
        ) : (
          <div className="aura-dse__chips">
            {recents.map(q => (
              <button key={q} onClick={() => onPick(q)} className="aura-dse__chip">
                {q}
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="aura-dse__sidebar-section">
        <MonoLabel className="aura-dse__sidebar-heading mb-2 block" size={16}>
          trending{lang !== 'all' ? ` · ${lang}` : ''}
        </MonoLabel>
        <div className="aura-dse__chips">
          {trending.map(q => (
            <button key={q} onClick={() => onPick(q)} className="aura-dse__chip">
              {q}
            </button>
          ))}
        </div>
      </section>
    </aside>
  );
}
