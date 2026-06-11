import { useEffect, useRef, useState } from 'react';
import { Drawer, DrawerContent, DrawerTitle } from './ui/drawer';
import { PlaylistPickerBody } from './PlaylistPickerBody';
import { subscribeAddToPlaylist } from '../lib/addToPlaylistSheet';
import { cleanTitle } from '../utils/title';
import './AddToPlaylistSheet.css';

// Bus-driven "add to playlist" bottom sheet. A vaul Drawer owns the slide,
// drag-to-dismiss, focus trap and scroll lock; all per-open state lives in
// PlaylistPickerBody, reset via React key. The bus only ever emits open events
// (an { id, tracks } object); dismissal is local.
export function AddToPlaylistSheet() {
  const [event, setEvent] = useState(null);
  // Keep the last event around so the sheet still has data to render through
  // vaul's slide-down (event is cleared the instant a close is requested).
  const lastRef = useRef(null);
  if (event) lastRef.current = event;

  useEffect(() => subscribeAddToPlaylist(setEvent), []);

  const open = !!event;
  const data = event ?? lastRef.current;
  const tracks = data?.tracks ?? [];
  const sublabel = tracks.length === 1
    ? cleanTitle(tracks[0].title ?? '')
    : `${tracks.length} tracks`;

  return (
    <Drawer open={open} onOpenChange={(o) => { if (!o) setEvent(null); }}>
      {data && (
        <DrawerContent className="aura-drawer__content--playlist">
          <div className="aura-sheet-header">
            <DrawerTitle className="aura-sheet-title">Add to playlist</DrawerTitle>
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
            <PlaylistPickerBody key={data.id} tracks={tracks} onPicked={() => setEvent(null)}/>
          </div>
        </DrawerContent>
      )}
    </Drawer>
  );
}
