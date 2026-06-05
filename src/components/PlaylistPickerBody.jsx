import { useEffect, useRef, useState } from 'react';
import { AuraLoader } from './feedback/AuraLoader';
import { listPlaylists, createPlaylist, addToPlaylist } from '../api/playlists';
import { toast } from '../lib/toast';

// Shared picker body — list of user playlists + inline "create new" row.
// Used by both AddToPlaylistSheet (bottom-sheet) and RailExtras (inline panel
// in the desktop right rail). All sheet/rail chrome lives in the consumer.
// `tracks` accepts an array. Sequential add keeps deterministic ordering and
// per-track error reporting; `duplicate` errors are skipped silently so a
// bulk add doesn't blow up because one track was already in the playlist —
// the success toast distinguishes the all-duplicates case so the user
// understands nothing was actually added.
export function PlaylistPickerBody({ tracks, onPicked, compact = false }) {
  const [playlists, setPlaylists] = useState(null);
  const [creating, setCreating]   = useState(false);
  const [newName, setNewName]     = useState('');
  const [busyId, setBusyId]       = useState(null);
  const inputRef = useRef(null);

  useEffect(() => {
    const ctl = new AbortController();
    listPlaylists({ signal: ctl.signal })
      .then(setPlaylists)
      .catch(err => {
        if (err.name === 'AbortError') return;
        toast(`Couldn't load playlists — ${err.message}`);
        setPlaylists([]);
      });
    return () => ctl.abort();
  }, []);

  useEffect(() => { if (creating) inputRef.current?.focus(); }, [creating]);

  const addAll = async (playlistId) => {
    let added = 0;
    for (const t of tracks) {
      try {
        await addToPlaylist(playlistId, t.id);
        added++;
      } catch (err) {
        if (err.code !== 'duplicate') throw err;
      }
    }
    return added;
  };

  const successToast = (playlistName, added) => {
    if (tracks.length === 1) {
      if (added === 1) toast(`Added to ${playlistName}.`);
      else toast(`Already in ${playlistName}.`);
    } else if (added === 0) {
      toast(`All tracks already in ${playlistName}.`);
    } else if (added === tracks.length) {
      toast(`Added ${added} tracks to ${playlistName}.`);
    } else {
      toast(`Added ${added} of ${tracks.length} to ${playlistName}.`);
    }
  };

  const pick = async (playlist) => {
    if (busyId) return;
    setBusyId(playlist.id);
    try {
      const added = await addAll(playlist.id);
      successToast(playlist.name, added);
      onPicked?.();
    } catch (err) {
      toast(`Couldn't add — ${err.message}`);
      setBusyId(null);
    }
  };

  const submitNew = async (e) => {
    e?.preventDefault?.();
    const name = newName.trim();
    if (!name) { setCreating(false); setNewName(''); return; }
    try {
      const playlist = await createPlaylist({ name });
      const added = await addAll(playlist.id);
      successToast(playlist.name, added);
      onPicked?.();
    } catch (err) {
      toast(`Couldn't create — ${err.message}`);
    }
  };

  const rowSize = compact ? 'aura-sheet-row aura-sheet-row--compact' : 'aura-sheet-row';

  return (
    <>
      {creating ? (
        <form onSubmit={submitNew} className="aura-pl-create">
          <div className="aura-pl-create__eyebrow">New playlist</div>
          <div className="aura-pl-create__row">
            <span className="aura-sheet-cover-fallback">+</span>
            <input
              ref={inputRef}
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Escape') { setCreating(false); setNewName(''); } }}
              placeholder="Name your playlist"
              className="aura-pl-create-input"
            />
          </div>
          <div className="aura-pl-create__actions">
            <button type="button" onClick={() => { setCreating(false); setNewName(''); }} className="aura-pl-create__cancel">
              Cancel
            </button>
            <button type="submit" disabled={!newName.trim()} className="aura-pl-create__submit">
              Create
            </button>
          </div>
        </form>
      ) : (
        <button onClick={() => setCreating(true)} className={rowSize}>
          <span className="aura-sheet-cover-fallback">+</span>
          <span className="aura-sheet-row__new-label">New playlist</span>
        </button>
      )}

      {playlists === null && (
        <div className="py-2">
          <AuraLoader label="Loading playlists"/>
        </div>
      )}

      {playlists !== null && playlists.length === 0 && !creating && (
        <div className="aura-sheet-empty">
          You don’t have any playlists yet. Tap “New playlist” above.
        </div>
      )}

      {(playlists ?? []).map(p => (
        <button key={p.id} onClick={() => pick(p)} disabled={busyId === p.id} className={rowSize}>
          {p.coverImageUrl
            ? <img src={p.coverImageUrl} alt="" className="aura-sheet-cover" loading="lazy"/>
            : <span className="aura-sheet-cover-fallback">{p.name?.[0]?.toUpperCase() ?? '·'}</span>}
          <div className="flex-1 min-w-0">
            <div className="aura-sheet-row__name truncate">{p.name}</div>
            <div className="aura-sheet-row__count">
              {p.trackCount} {p.trackCount === 1 ? 'track' : 'tracks'}
            </div>
          </div>
        </button>
      ))}
    </>
  );
}
