import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MonoLabel, AuraMark } from '../../components/primitives';
import { AlbumArt } from '../../components/album/AlbumArt';
import { fmtTime } from '../../utils/fmtTime';
import { cleanTitle } from '../../utils/title';
import { openAddToPlaylist } from '../../lib/addToPlaylistSheet';
import { ctxOpen } from '../../lib/trackContextMenu';
import { toast } from '../../lib/toast';
import { CrumbBack } from './CrumbBack';
import './DesktopQueue.css';

const EDGE_ZONE = 90;
const MAX_SCROLL_VELOCITY = 16;

export function DesktopQueue({
  tracks, currentIdx, source, djName,
  onPick, onClose, onRemove, onReorder,
  onPlayNext, onAddToQueue,
  onClear, onShuffle, shuffleActive = false, onSave,
  repeatMode = 'off', onCycleRepeat,
  autoNextBatch, onPlayAutoNext,
}) {
  const [menuId, setMenuId] = useState(null);
  // Per-row ⋯ popover lives in the scrolling queue list. We pin it with
  // position: fixed and viewport coords so it escapes the scroller's clip
  // (otherwise rows in the lower half show a popover that spills off the
  // visible area). flipUp + side anchoring mirrors MoreLikeThisCarousel.
  const [menuStyle, setMenuStyle] = useState({ top: 0, bottom: 'auto', right: 0, left: 'auto' });
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [drag, setDrag] = useState(null);
  const [hidePast, setHidePast] = useState(() => {
    try { return localStorage.getItem('aura.queueHidePast') === '1'; }
    catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem('aura.queueHidePast', hidePast ? '1' : '0'); }
    catch { /* localStorage disabled — non-fatal */ }
  }, [hidePast]);
  const listRef = useRef(null);
  const scrollerRef = useRef(null);
  const dragRef = useRef(null);
  const rafRef = useRef(0);

  const visibleCount = hidePast ? tracks.length - currentIdx : tracks.length;

  useEffect(() => { dragRef.current = drag; }, [drag]);
  useEffect(() => () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); }, []);

  const computeHover = (clientY, scrollTop, d) => {
    const scrollDelta = scrollTop - d.startScrollTop;
    const effY = clientY + scrollDelta;
    let hoverTo = d.from;
    for (let k = 0; k < d.rects.length; k++) {
      const r = d.rects[k];
      // Rect entries carry their absolute track index (from data-idx) so
      // hoverTo lands on the right track even when past rows are hidden.
      if (effY < r.top + r.height / 2) { hoverTo = r.idx; break; }
      hoverTo = r.idx;
    }
    return { hoverTo, scrollDelta };
  };

  const tick = () => {
    rafRef.current = 0;
    const d = dragRef.current;
    const c = scrollerRef.current;
    if (!d || !c) return;
    const box = c.getBoundingClientRect();
    const topGap    = d.currentY - box.top;
    const bottomGap = box.bottom - d.currentY;
    let velocity = 0;
    if (topGap < EDGE_ZONE)    velocity = -Math.min(MAX_SCROLL_VELOCITY, (EDGE_ZONE - topGap) / 4);
    else if (bottomGap < EDGE_ZONE) velocity = Math.min(MAX_SCROLL_VELOCITY, (EDGE_ZONE - bottomGap) / 4);
    if (velocity === 0) return;
    const before = c.scrollTop;
    const max = c.scrollHeight - c.clientHeight;
    c.scrollTop = Math.max(0, Math.min(max, before + velocity));
    if (c.scrollTop !== before) {
      const { hoverTo, scrollDelta } = computeHover(d.currentY, c.scrollTop, d);
      setDrag(prev => prev && { ...prev, hoverTo, scrollDelta });
    }
    rafRef.current = requestAnimationFrame(tick);
  };

  const onDragStart = (i) => (e) => {
    if (!onReorder) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    // When past tracks are collapsed they're still in the DOM (so the
    // height animation can run) but have no real geometry — exclude
    // their data-row entries so the drop-index calculation isn't
    // skewed by phantom zero-height zones at the top of the list.
    const selector = hidePast
      ? '[data-row]:not(.aura-dq__past-wrap--collapsed [data-row])'
      : '[data-row]';
    const rects = listRef.current
      ? [...listRef.current.querySelectorAll(selector)].map(el => {
          const r = el.getBoundingClientRect();
          return { top: r.top, height: r.height, idx: Number(el.dataset.idx) };
        })
      : [];
    setDrag({
      from: i, startY: e.clientY, currentY: e.clientY,
      hoverTo: i, rects,
      startScrollTop: scrollerRef.current?.scrollTop ?? 0,
      scrollDelta: 0,
    });
  };
  const onDragMove = (e) => {
    if (!drag) return;
    const sc = scrollerRef.current?.scrollTop ?? drag.startScrollTop;
    const { hoverTo, scrollDelta } = computeHover(e.clientY, sc, drag);
    setDrag(d => d && { ...d, currentY: e.clientY, hoverTo, scrollDelta });
    if (!rafRef.current) rafRef.current = requestAnimationFrame(tick);
  };
  const onDragEnd = () => {
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = 0; }
    if (drag && drag.from !== drag.hoverTo) onReorder?.(drag.from, drag.hoverTo);
    setDrag(null);
  };

  const playNext = (t) => { setMenuId(null); onPlayNext?.(t); toast('Queued next.'); };
  const addToQueue = (t) => { setMenuId(null); onAddToQueue?.(t); toast('Added to queue.'); };
  const addToPlaylistFn = (t) => { setMenuId(null); openAddToPlaylist(t); };

  // `i` is the absolute track index (not a per-slice offset). The renderer
  // is called from both the past-tracks slice and the current+future slice
  // — using absolute indices everywhere means drag-reorder, idx labels,
  // and onRemove/onPick wiring all stay consistent regardless of which
  // slice the row was rendered from.
  const renderRow = (t, i) => {
    const isCurrent  = i === currentIdx;
    const isPast     = i < currentIdx;
    const isDragging = drag?.from === i;
    let shift = 0;
    if (drag && !isDragging) {
      const first = listRef.current?.querySelector('[data-row]');
      const step  = first ? first.offsetHeight : 0;
      if (drag.from < drag.hoverTo && i > drag.from && i <= drag.hoverTo) shift = -step;
      else if (drag.from > drag.hoverTo && i >= drag.hoverTo && i < drag.from) shift = step;
    }
    const style = isDragging
      ? { transform: `translateY(${drag.currentY - drag.startY + drag.scrollDelta}px) scale(1.01)`, zIndex: 5 }
      : shift
        ? { transform: `translateY(${shift}px)`, transition: 'transform 240ms cubic-bezier(.25,.85,.3,1)' }
        : { transition: 'transform 240ms cubic-bezier(.25,.85,.3,1)' };
    return (
      <div key={t.id + i} data-row data-idx={i} style={style} onContextMenu={ctxOpen(t)}
        className={`aura-dq__row ${isPast ? 'aura-dq__row--past' : ''} ${isDragging ? 'aura-dq__row--dragging' : ''}`}>
        {onReorder && (
          <button type="button"
            onPointerDown={onDragStart(i)}
            onPointerMove={onDragMove}
            onPointerUp={onDragEnd}
            onPointerCancel={onDragEnd}
            aria-label="reorder"
            className="aura-dq__handle touch-none">
            <svg width="10" height="14" viewBox="0 0 10 14">
              <circle cx="3" cy="3"  r="1.2" fill="currentColor"/>
              <circle cx="7" cy="3"  r="1.2" fill="currentColor"/>
              <circle cx="3" cy="7"  r="1.2" fill="currentColor"/>
              <circle cx="7" cy="7"  r="1.2" fill="currentColor"/>
              <circle cx="3" cy="11" r="1.2" fill="currentColor"/>
              <circle cx="7" cy="11" r="1.2" fill="currentColor"/>
            </svg>
          </button>
        )}
        <div className={`aura-dq__idx ${isCurrent ? 'aura-dq__idx--current' : ''}`}>
          {String(i + 1).padStart(2, '0')}
        </div>
        <button onClick={() => onPick?.(i)} className="aura-dq__main">
          <AlbumArt track={t} size={54} radius={4}/>
          <div className="flex-1 min-w-0">
            <div className="aura-dq__title">
              <span className="aura-dq__title-text">{cleanTitle(t.title)}</span>
              {isCurrent && <span className="aura-dq__now-mark"><AuraMark size={16}/></span>}
              {isCurrent && <span className="aura-dq__now">Now Playing</span>}
            </div>
            <MonoLabel className="text-ink-soft mt-1.5 block truncate" size={9.5}>
              {t.artist ?? ''}
            </MonoLabel>
          </div>
          <MonoLabel className="aura-dq__duration text-ink-faint shrink-0 ml-4" size={10} numeric>
            {fmtTime(t.durationSec)}
          </MonoLabel>
        </button>
        <div className="relative">
          <button type="button"
            onClick={(e) => {
              e.stopPropagation();
              const id = t.id + i;
              if (menuId === id) { setMenuId(null); return; }
              const r = e.currentTarget.getBoundingClientRect();
              const GAP = 6;
              // Menu is ~150 px tall (3 items + outer padding). Flip up when
              // there isn't comfortable room below the trigger so past-track
              // rows (lower half of the visible scroller) don't clip the menu.
              const flipUp = window.innerHeight - r.bottom < 220;
              const useLeftAnchor = r.left < window.innerWidth / 2;
              const horizontal = useLeftAnchor
                ? { left: r.left, right: 'auto' }
                : { left: 'auto', right: window.innerWidth - r.right };
              setMenuStyle(flipUp
                ? { top: 'auto', bottom: window.innerHeight - r.top + GAP, ...horizontal }
                : { top: r.bottom + GAP, bottom: 'auto', ...horizontal });
              setMenuId(id);
            }}
            aria-label="more"
            className="aura-dq__more">
            <svg width="4" height="16" viewBox="0 0 4 16">
              <circle cx="2" cy="3"  r="1.6" fill="currentColor"/>
              <circle cx="2" cy="8"  r="1.6" fill="currentColor"/>
              <circle cx="2" cy="13" r="1.6" fill="currentColor"/>
            </svg>
          </button>
          {menuId === t.id + i && createPortal(
            <div className="aura-pl-menu"
              style={{ position: 'fixed', ...menuStyle, marginTop: 0 }}
              onClick={(e) => e.stopPropagation()}>
              <button onClick={() => playNext(t)}        className="aura-pl-menu-item">Play next</button>
              <button onClick={() => addToQueue(t)}      className="aura-pl-menu-item">Add to queue</button>
              <button onClick={() => addToPlaylistFn(t)} className="aura-pl-menu-item">Add to playlist</button>
            </div>,
            document.body,
          )}
        </div>
        {!isCurrent && onRemove && (
          <button onClick={() => onRemove(i)} className="aura-dq__x" aria-label="remove">
            <svg width="12" height="12" viewBox="0 0 12 12">
              <path d="M2 2 L10 10 M10 2 L2 10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
            </svg>
          </button>
        )}
      </div>
    );
  };

  return (
    <div ref={scrollerRef} className="aura-dq" onClick={() => { setMenuId(null); setOverflowOpen(false); }}>
      <div className="aura-dq__header">
        <div className="flex items-center gap-3.5">
          <CrumbBack onClick={onClose}/>
          <MonoLabel className="text-ink-faint" size={10}>
            {djName} · Your set, adapting live
          </MonoLabel>
        </div>
        <h1 className="aura-dq__hero">
          <em>{source}</em>.
        </h1>
        <div className="mt-3.5 flex items-baseline justify-between gap-4 flex-wrap aura-dq__meta-row">
          <MonoLabel className="text-ink-faint aura-dq__count" size={10}>
            {visibleCount} {visibleCount === 1 ? 'track' : 'tracks'}
          </MonoLabel>
          <div className="flex items-center gap-1 relative aura-dq__meta-actions">
            {currentIdx > 0 && (
              <button type="button"
                title={hidePast ? 'Show tracks you’ve already played' : 'Hide tracks you’ve already played'}
                onClick={() => setHidePast(p => !p)}
                className="aura-dq__action-btn">
                {hidePast ? 'Show past' : 'Hide past'}
              </button>
            )}
            {onShuffle && (
              <button type="button"
                title={shuffleActive ? 'Stop shuffling — restore queue order' : 'Shuffle the upcoming tracks'}
                onClick={onShuffle}
                disabled={!shuffleActive && tracks.length - currentIdx <= 2}
                className={`aura-dq__action-btn ${shuffleActive ? 'aura-dq__action-btn--on' : ''}`}
                aria-label={shuffleActive ? 'Shuffle on — tap to deactivate' : 'Shuffle up-next'}>
                Shuffle
              </button>
            )}
            {onCycleRepeat && (
              <button type="button"
                title={repeatMode === 'one' ? 'Repeat the current track' : repeatMode === 'all' ? 'Repeat the queue' : 'Repeat is off — tap to cycle'}
                onClick={onCycleRepeat}
                className={`aura-dq__action-btn aura-dq__action-btn--repeat ${repeatMode !== 'off' ? 'aura-dq__action-btn--on' : ''}`}
                aria-label={`Repeat: ${repeatMode}`}>
                {repeatMode === 'one' ? 'Repeat 1' : repeatMode === 'all' ? 'Repeat all' : 'Repeat'}
              </button>
            )}
            <button type="button"
              title="More queue actions"
              onClick={(e) => { e.stopPropagation(); setOverflowOpen(o => !o); }}
              aria-label="More queue actions"
              aria-expanded={overflowOpen}
              className={`aura-dq__overflow-btn ${overflowOpen ? 'aura-dq__overflow-btn--on' : ''}`}>
              <svg width="4" height="16" viewBox="0 0 4 16">
                <circle cx="2" cy="3"  r="1.6" fill="currentColor"/>
                <circle cx="2" cy="8"  r="1.6" fill="currentColor"/>
                <circle cx="2" cy="13" r="1.6" fill="currentColor"/>
              </svg>
            </button>
            {overflowOpen && (
              <div className="aura-pl-menu aura-dq__overflow-menu" onClick={(e) => e.stopPropagation()}>
                {onSave && tracks.length > 0 && (
                  <button onClick={() => { setOverflowOpen(false); onSave(); }} className="aura-pl-menu-item">
                    Save as playlist
                  </button>
                )}
                {tracks.length > 0 && (
                  <button onClick={() => { setOverflowOpen(false); openAddToPlaylist(tracks); }} className="aura-pl-menu-item">
                    Add to a playlist
                  </button>
                )}
                {onClear && tracks.length > 1 && (
                  <button onClick={() => { setOverflowOpen(false); onClear(); }} className="aura-pl-menu-item">
                    Clear queue
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <div ref={listRef} className="aura-dq__list">
        {/* Past tracks — always rendered so the collapse can animate.
            Wrapped in a grid-template-rows-animated container that
            shrinks to 0fr when hidePast is true. */}
        {currentIdx > 0 && (
          <div className={`aura-dq__past-wrap ${hidePast ? 'aura-dq__past-wrap--collapsed' : ''}`} aria-hidden={hidePast}>
            <div className="aura-dq__past-inner">
              {tracks.slice(0, currentIdx).map((t, i) => renderRow(t, i))}
            </div>
          </div>
        )}
        {/* Current + future tracks — flat in the list */}
        {tracks.slice(currentIdx).map((t, j) => renderRow(t, currentIdx + j))}
        {/* AURA's prefetched continuation batch, surfaced as a faded "coming up"
            list when sitting on the last non-wrapping track. Clicking a row
            fills the whole batch into the queue and plays from that row. Hidden
            in repeat modes (the batch would never be reached). */}
        {autoNextBatch?.length > 0 && currentIdx === tracks.length - 1 && source !== "tonight's set" && repeatMode === 'off' && (
          <div className="aura-dq__radio">
            <div className="aura-dq__radio-label">Up next · Picked by AURA</div>
            {autoNextBatch.map((t, i) => (
              <button key={t.id + i} type="button"
                onClick={() => onPlayAutoNext?.(i)}
                className="aura-dq__radio-row"
                aria-label={`play next: ${t.title}`}>
                <AlbumArt track={t} size={44} radius={4}/>
                <div className="aura-dq__radio-meta">
                  <div className="aura-dq__radio-title">{cleanTitle(t.title)}</div>
                  <MonoLabel className="text-ink-soft mt-1.5 block truncate" size={9.5}>
                    {t.artist ?? ''}
                  </MonoLabel>
                </div>
                <span className="aura-dq__radio-cta">Play</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
