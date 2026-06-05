import { useEffect, useState } from 'react';
import { MonoLabel } from '../../components/primitives';
import { AlbumArt } from '../../components/album/AlbumArt';
import { AuraLoader } from '../../components/feedback/AuraLoader';
import { getJournal } from '../../api/journal';
import { cleanTitle } from '../../utils/title';
import './DesktopJournal.css';

// Desktop journal — large serif editorial layout, 180px date column on first
// entry, 140px on rest. Real entries from /api/journal (auto-written by AURA).
export function DesktopJournal({ djName, onPickLive }) {
  const [hit, setHit] = useState({ data: null, error: null });
  const status = hit.error ? 'error' : hit.data ? 'ok' : 'loading';

  useEffect(() => {
    const ctl = new AbortController();
    getJournal({ days: 7, signal: ctl.signal })
      .then(data => setHit({ data, error: null }))
      .catch(err => {
        if (err.name === 'AbortError') return;
        setHit({ data: null, error: err.message });
      });
    return () => ctl.abort();
  }, []);

  const entries = hit.data?.entries ?? [];

  return (
    <div className="aura-djr">
      <div className="aura-djr__header">
        <MonoLabel className="text-ink-faint" size={10}>
          listening journal · auto-written by {djName.toLowerCase()} · private
        </MonoLabel>
        <h1 className="aura-djr__hero">
          What you listened<br/><em>to, and why.</em>
        </h1>
      </div>

      <div className="aura-djr__scroll">
        {status === 'loading' && (
          <AuraLoader label="Loading journal"/>
        )}

        {status === 'error' && (
          <div className="aura-djr__error">
            Couldn’t load the journal — {hit.error}
          </div>
        )}

        {status === 'ok' && entries.length === 0 && (
          <div className="aura-djr__empty">
            <div className="aura-djr__empty-title">Your journal is waiting on you.</div>
            <div className="aura-djr__empty-body">
              Listen for a while — entries appear once you’ve played a handful of songs.
            </div>
          </div>
        )}

        {status === 'ok' && entries.length > 0 && (
          <div className="aura-djr__entries">
            {entries.map((e, i) => (
              <Entry key={e.date ?? i} entry={e} isFirst={i === 0} onPickLive={onPickLive}/>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Entry({ entry, isFirst, onPickLive }) {
  return (
    <article className={`aura-djr__entry ${isFirst ? 'aura-djr__entry--first' : ''}`}>
      <div>
        <MonoLabel className="text-ink-faint" size={10}>{entry.date}</MonoLabel>
        {entry.tag && (
          <div className="aura-djr__tag">{entry.tag}</div>
        )}
      </div>
      <div>
        <div className="aura-djr__entry-headline">{entry.headline}</div>
        <div className="aura-djr__entry-body">{entry.body}</div>
        {entry.tracks?.length > 0 && (
          <div className="aura-djr__tracks">
            <MonoLabel className="text-ink-faint" size={9}>tracks heard</MonoLabel>
            <div className="flex gap-2 mt-2">
              {entry.tracks.slice(0, 6).map(t => (
                <button key={t.id} onClick={() => onPickLive?.(t)}
                  className="aura-djr__thumb" title={`${cleanTitle(t.title)} — ${t.artist}`}>
                  <AlbumArt track={t} size={48} radius={4}/>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </article>
  );
}
