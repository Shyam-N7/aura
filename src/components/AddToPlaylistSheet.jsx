import { useEffect, useRef, useState } from 'react';
import { PlaylistPickerBody } from './PlaylistPickerBody';
import { subscribeAddToPlaylist } from '../lib/addToPlaylistSheet';
import { cleanTitle } from '../utils/title';
import './AddToPlaylistSheet.css';

// Outer component listens to the bus and decides whether to render the sheet.
// All per-open state lives inside the picker body and is reset via React key.
//
// Drag-to-dismiss: the grip area at the top of the sheet (visible handle + a
// touch band around it) plus the header act as the drag region. Pointer events
// capture the pointer to the sheet root and drive the translateY *imperatively*
// — writing sheetRef.current.style.transform directly so a drag never triggers
// a React re-render of the (potentially long) playlist list. Release past 20%
// of the sheet's height triggers the close animation; below that it snaps back.
// Touches on the list itself fall through (no drag armed) so it scrolls.
export function AddToPlaylistSheet() {
  const [event, setEvent] = useState(null);
  const [closing, setClosing] = useState(false);
  const dragStartY = useRef(0);
  // `armed` = pointer captured + waiting to cross the activation threshold.
  // `dragging` flips to true only after that threshold is crossed — so a
  // click-and-hold without movement never produces translateY values.
  const armed = useRef(false);
  const dragging = useRef(false);
  const sheetRef = useRef(null);

  useEffect(() => subscribeAddToPlaylist(setEvent), []);

  if (!event) return null;
  const { tracks } = event;

  const sublabel = tracks.length === 1
    ? cleanTitle(tracks[0].title ?? '')
    : `${tracks.length} tracks`;

  // Animate the sheet down off-screen, then unmount. Cancelling the opening
  // `aura-sheet-rise` animation first is required — its `both` fill mode would
  // otherwise pin transform at translateY(0) and override our inline value.
  const dismiss = () => {
    if (closing) return;
    setClosing(true);
    const el = sheetRef.current;
    if (el) {
      el.style.animation = 'none';
      el.style.transition = 'transform 240ms cubic-bezier(.4, 0, .2, 1)';
      el.style.transform = 'translateY(100%)';
      el.style.willChange = 'transform';
    }
    setTimeout(() => { setEvent(null); setClosing(false); }, 240);
  };

  // Drag is gated by a movement threshold: pointerdown only captures the
  // pointer + records the start. The sheet doesn't translate until the pointer
  // has moved DOWN past ACTIVATION px, so a tap/hold or trackpad jitter never
  // produces visible movement. All translate writes are imperative (no state).
  const ACTIVATION = 8;
  const onPointerDown = (e) => {
    if (closing) return;
    sheetRef.current?.setPointerCapture(e.pointerId);
    dragStartY.current = e.clientY;
    armed.current = true;
    dragging.current = false;
  };
  const onPointerMove = (e) => {
    if (!armed.current) return;
    const raw = e.clientY - dragStartY.current;
    if (!dragging.current) {
      // Wait for the activation threshold; upward moves never arm (raw < 0).
      if (raw < ACTIVATION) return;
      dragging.current = true;
      const el = sheetRef.current;
      if (el) {
        // Kill the opening animation + transition so the finger drives transform
        // 1:1 with no easing lag — this is what makes the drag feel direct.
        el.style.animation = 'none';
        el.style.transition = 'none';
        el.style.willChange = 'transform';
      }
    }
    const el = sheetRef.current;
    if (el) el.style.transform = `translateY(${Math.max(0, raw)}px)`;
  };
  const onPointerUp = (e) => {
    if (!armed.current) return;
    try { sheetRef.current?.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    armed.current = false;
    const wasDragging = dragging.current;
    dragging.current = false;
    if (!wasDragging) return;   // never crossed the threshold — stray click, no-op
    const dy = Math.max(0, e.clientY - dragStartY.current);
    const el = sheetRef.current;
    const sheetH = el?.getBoundingClientRect().height ?? 1;
    // 20% of height or 100 px, whichever's smaller — easy to dismiss without
    // being trigger-happy.
    const threshold = Math.min(sheetH * 0.20, 100);
    if (dy > threshold) {
      dismiss();
    } else if (el) {
      // Smooth spring back to rest, then drop the inline transition/will-change.
      el.style.transition = 'transform 240ms cubic-bezier(.22, 1, .36, 1)';
      el.style.transform = 'translateY(0px)';
      const onEnd = () => {
        el.style.transition = '';
        el.style.willChange = '';
        el.removeEventListener('transitionend', onEnd);
      };
      el.addEventListener('transitionend', onEnd);
    }
  };

  const dragHandlers = {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel: onPointerUp,
  };

  return (
    <>
      <div className="aura-sheet-backdrop" onClick={dismiss}/>
      <div ref={sheetRef} className="aura-sheet" onClick={e => e.stopPropagation()}>
        {/* Dismiss hint in the dimmed area above the sheet — advertises the
            backdrop tap (the swipe-down handle below is the other way out).
            pointer-events:none so a tap here falls through to the backdrop. */}
        <div className="aura-sheet-hint" aria-hidden="true">Tap anywhere to close</div>
        <div className="aura-sheet-grip" {...dragHandlers}>
          <div className="aura-sheet-handle"/>
        </div>
        <div className="aura-sheet-header" {...dragHandlers}>
          <div className="aura-sheet-title">Add to playlist</div>
          <div className="aura-sheet-subtitle">{sublabel}</div>
        </div>
        {tracks.length > 1 && (
          <div className="aura-sheet-preview">
            {tracks.slice(0, 3).map((t, i) => (
              <div key={i} className="aura-sheet-preview__item">{cleanTitle(t.title ?? '')}</div>
            ))}
            {tracks.length > 3 && (
              <div className="aura-sheet-preview__more">+{tracks.length - 3} more</div>
            )}
          </div>
        )}
        <div className="aura-sheet-list">
          <PlaylistPickerBody key={event.id} tracks={tracks} onPicked={dismiss}/>
        </div>
      </div>
    </>
  );
}
