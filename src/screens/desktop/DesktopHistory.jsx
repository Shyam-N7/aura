import { useEffect, useMemo, useState } from 'react';
import { MonoLabel } from '../../components/primitives';
import { AlbumArt } from '../../components/album/AlbumArt';
import { AuraLoader } from '../../components/feedback/AuraLoader';
import { getHistory, getMusicClockPlays } from '../../api/stats';
import { summarizeClock } from '../../lib/musicClock';
import { formatTime12 } from '../../hooks/useNow';
import { cleanTitle } from '../../utils/title';
import { ctxPress } from '../../lib/trackContextMenu';
import { AnchoredMenu } from '../../components/AnchoredMenu';
import { openAddToPlaylist } from '../../lib/addToPlaylistSheet';
import { toast } from '../../lib/toast';
import { CrumbBack } from './CrumbBack';
import { useScrollMemory } from '../../hooks/useScrollMemory';
import { BackToTop } from '../../components/BackToTop';
import '../PlaylistsScreen.css';        // .aura-pl-menu-item (AnchoredMenu items)
import './DesktopPlaylistDetail.css';   // reuse the .aura-dpd detail layout + rows
import './DesktopHistory.css';

const dateKeyLocal = (ts) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};

function dayHeading(ts, todayKey, yesterdayKey) {
  const key = dateKeyLocal(ts);
  if (key === todayKey) return 'Today';
  if (key === yesterdayKey) return 'Yesterday';
  return new Date(ts).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

// The time-of-day insight, derived entirely client-side (local time) from the
// windowed clock plays.
function MusicClock({ clock }) {
  return (
    <section className="aura-dhist__clock">
      <MonoLabel className="text-ink-faint" size={10}>your music clock</MonoLabel>
      <p className="aura-dhist__clock-sub">What you play most at each time of day.</p>

      <div className="aura-dhist__clock-bar" aria-hidden="true">
        {clock.parts.map(p => (
          <span key={p.key}
            className={`aura-dhist__clock-seg aura-dhist__clock-seg--${p.key}`}
            style={{ flexGrow: p.plays || 0.04 }}/>
        ))}
      </div>

      <div className="aura-dhist__clock-parts">
        {clock.parts.map(p => (
          <div key={p.key} className="aura-dhist__clock-part">
            <div className="aura-dhist__clock-part-head">
              <span className="aura-dhist__clock-label">{p.label}</span>
              <span className="aura-dhist__clock-count">{p.plays}</span>
            </div>
            {p.topTracks.length ? (
              <ul className="aura-dhist__clock-tracks">
                {p.topTracks.map(t => <li key={t.trackId}>{cleanTitle(t.title)}</li>)}
              </ul>
            ) : (
              <div className="aura-dhist__clock-empty">—</div>
            )}
          </div>
        ))}
      </div>

      {(clock.afterMidnight || clock.busiest) && (
        <div className="aura-dhist__clock-headline">
          {clock.afterMidnight
            ? <><em>{cleanTitle(clock.afterMidnight.title)}</em> is your most-played after midnight.</>
            : <>You listen most in the <em>{clock.busiest.label}</em>.</>}
        </div>
      )}
    </section>
  );
}

// Full listening history: a time-of-day "music clock" on top, then every play
// grouped by local day. Reachable from the library.
export function DesktopHistory({ onClose, onPickLive, onPlayNext, onAddToQueue }) {
  const [plays, setPlays]   = useState([]);
  const [nextBefore, setNextBefore] = useState(null);
  const [clock, setClock]   = useState(null);
  const [status, setStatus] = useState('loading');
  const [loadingMore, setLoadingMore] = useState(false);
  const [menu, setMenu] = useState(null);
  const scrollRef = useScrollMemory('history', { ready: status === 'ok' });

  useEffect(() => {
    const ctl = new AbortController();
    Promise.all([
      getHistory({ limit: 80, signal: ctl.signal }),
      getMusicClockPlays({ signal: ctl.signal }).catch(() => []),
    ]).then(([h, clockPlays]) => {
      setPlays(h.plays);
      setNextBefore(h.nextBefore);
      setClock(summarizeClock(clockPlays, { perPart: 2 }));
      setStatus('ok');
    }).catch(err => {
      if (err.name === 'AbortError') return;
      setStatus('error');
    });
    return () => ctl.abort();
  }, []);

  const loadMore = () => {
    if (!nextBefore || loadingMore) return;
    setLoadingMore(true);
    getHistory({ limit: 80, before: nextBefore })
      .then(h => { setPlays(prev => [...prev, ...h.plays]); setNextBefore(h.nextBefore); })
      .catch(() => {})
      .finally(() => setLoadingMore(false));
  };

  // Plays arrive newest-first; walk them once into contiguous local-day groups.
  const days = useMemo(() => {
    const now = new Date();
    const todayKey = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`;
    const yd = new Date(now); yd.setDate(now.getDate() - 1);
    const yesterdayKey = `${yd.getFullYear()}-${yd.getMonth()}-${yd.getDate()}`;
    const out = [];
    let cur = null;
    for (const p of plays) {
      const key = dateKeyLocal(p.playedAt);
      if (!cur || cur.key !== key) {
        cur = { key, heading: dayHeading(p.playedAt, todayKey, yesterdayKey), rows: [] };
        out.push(cur);
      }
      cur.rows.push(p);
    }
    return out;
  }, [plays]);

  const playOne   = (t) => { setMenu(null); onPickLive?.(t); };
  const playNext  = (t) => { setMenu(null); onPlayNext?.(t); toast('Queued next.'); };
  const addQueue  = (t) => { setMenu(null); onAddToQueue?.(t); toast('Added to queue.'); };
  const addToList = (t) => { setMenu(null); openAddToPlaylist(t); };

  return (
    <div ref={scrollRef} className="aura-dpd" onClick={() => setMenu(null)}>
      <div className="aura-dpd__header">
        <div className="flex items-center gap-3.5">
          <CrumbBack onClick={onClose}/>
        </div>
        <h1 className="aura-dpd__hero"><em>your history</em>.</h1>
      </div>

      <div className="aura-dpd__scroll">
        {status === 'loading' && <AuraLoader label="Loading history"/>}
        {status === 'error' && <div className="aura-dpd__error">Couldn’t load your history.</div>}

        {status === 'ok' && plays.length === 0 && (
          <div className="aura-dpd__empty">
            <div className="aura-dpd__empty-title">Nothing played yet.</div>
            <div className="aura-dpd__empty-body">Your history fills in as you listen.</div>
          </div>
        )}

        {status === 'ok' && plays.length > 0 && (
          <div className="aura-dpd__list">
            {clock && clock.totalPlays > 0 && <MusicClock clock={clock}/>}

            {days.map(day => (
              <div key={day.key} className="aura-dhist__day">
                <div className="aura-dhist__day-head">{day.heading}</div>
                {day.rows.map((t) => {
                  const rowKey = `${t.id}-${t.playedAt}`;
                  return (
                    <div key={rowKey} className="aura-dpd__row" {...ctxPress(t)}>
                      <button onClick={() => onPickLive?.(t)} className="aura-dpd__main">
                        <AlbumArt track={t} size={50} radius={4}/>
                        <div className="flex-1 min-w-0">
                          <div className="aura-dpd__title">{cleanTitle(t.title)}</div>
                          <MonoLabel className="text-ink-soft mt-1.5 block truncate" size={9.5}>
                            {(t.artist ?? '').toLowerCase()} · {t.language ?? ''}
                          </MonoLabel>
                        </div>
                        <MonoLabel className="text-ink-faint shrink-0 ml-4" size={10}>
                          {formatTime12(new Date(t.playedAt))}
                        </MonoLabel>
                      </button>
                      <div className="relative">
                        <button type="button" aria-label="more" className="aura-dpd__more"
                          onClick={(e) => { e.stopPropagation(); const el = e.currentTarget; setMenu(m => m?.k === rowKey ? null : { k: rowKey, el, t }); }}>
                          <svg width="4" height="16" viewBox="0 0 4 16">
                            <circle cx="2" cy="3"  r="1.6" fill="currentColor"/>
                            <circle cx="2" cy="8"  r="1.6" fill="currentColor"/>
                            <circle cx="2" cy="13" r="1.6" fill="currentColor"/>
                          </svg>
                        </button>
                        {menu?.k === rowKey && (
                          <AnchoredMenu anchorEl={menu.el} onClose={() => setMenu(null)} estHeight={166}>
                            <button onClick={() => playOne(t)}    className="aura-pl-menu-item">play song</button>
                            <button onClick={() => playNext(t)}   className="aura-pl-menu-item">play next</button>
                            <button onClick={() => addQueue(t)}   className="aura-pl-menu-item">add to queue</button>
                            <button onClick={() => addToList(t)}  className="aura-pl-menu-item">add to my playlist</button>
                          </AnchoredMenu>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}

            {nextBefore && (
              <div className="aura-dhist__more">
                <button onClick={loadMore} disabled={loadingMore} className="aura-dhist__more-btn">
                  {loadingMore ? 'Loading…' : 'Load more'}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
      <BackToTop scrollRef={scrollRef}/>
    </div>
  );
}
