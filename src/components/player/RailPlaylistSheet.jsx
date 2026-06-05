import { MonoLabel } from '../primitives';
import { PlaylistPickerBody } from '../PlaylistPickerBody';
import { cleanTitle } from '../../utils/title';
import './RailPlaylistSheet.css';

// Rail-scoped add-to-playlist sheet. Same handle / slide-up / glass aesthetic
// as the global AddToPlaylistSheet, but absolutely positioned inside the rail
// so it covers only the rail's column instead of the whole viewport.
export function RailPlaylistSheet({ track, onClose }) {
  return (
    <>
      <div className="aura-rail-sheet-backdrop" onClick={onClose}/>
      <div className="aura-rail-sheet" onClick={e => e.stopPropagation()}>
        <div className="aura-rail-sheet__handle"/>
        <div className="aura-rail-sheet__header">
          <MonoLabel className="text-ink-faint" size={9}>add to playlist</MonoLabel>
          <div className="aura-rail-sheet__title">{cleanTitle(track.title)}</div>
        </div>
        <div className="aura-rail-sheet__list">
          <PlaylistPickerBody key={track.id} tracks={[track]} onPicked={onClose} compact/>
        </div>
      </div>
    </>
  );
}
