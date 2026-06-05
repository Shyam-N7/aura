import { useEffect, useRef, useState } from 'react';
import { listPlaylists, createPlaylist, deletePlaylist } from '../api/playlists';
import { toast } from '../lib/toast';
import { confirm } from '../lib/confirm';
import './PlaylistsScreen.css';

export function PlaylistsScreen({ onClose, onOpenPlaylist }) {
  const [hit, setHit]       = useState({ data: null, error: null });
  const [creating, setCreating] = useState(false);
  const [newName, setNewName]   = useState('');
  const [menuId, setMenuId]     = useState(null);
  const inputRef = useRef(null);
  const status = hit.error ? 'error' : hit.data ? 'ok' : 'loading';

  useEffect(() => {
    const ctl = new AbortController();
    listPlaylists({ signal: ctl.signal })
      .then(data => setHit({ data, error: null }))
      .catch(err => {
        if (err.name === 'AbortError') return;
        setHit({ data: null, error: err.message });
      });
    return () => ctl.abort();
  }, []);

  useEffect(() => {
    if (creating) inputRef.current?.focus();
  }, [creating]);

  const submitNew = async (e) => {
    e?.preventDefault?.();
    const name = newName.trim();
    if (!name) { setCreating(false); setNewName(''); return; }
    try {
      const playlist = await createPlaylist({ name });
      setHit(h => ({ ...h, data: [playlist, ...(h.data ?? [])] }));
      toast('Playlist created.');
      setNewName('');
      setCreating(false);
    } catch (err) {
      toast(`Couldn’t create — ${err.message}`);
    }
  };

  const remove = async (playlist) => {
    setMenuId(null);
    const ok = await confirm({
      title: `Delete “${playlist.name}”?`,
      body:  'The playlist will be removed. Songs you’ve liked stay in your library.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      await deletePlaylist(playlist.id);
      setHit(h => ({ ...h, data: (h.data ?? []).filter(p => p.id !== playlist.id) }));
      toast('Playlist deleted.');
    } catch (err) {
      toast(`Couldn’t delete — ${err.message}`);
    }
  };

  const lists = hit.data ?? [];

  return (
    <div className="absolute inset-0 bg-bg text-ink pt-5 overflow-auto pb-24 animate-aura-sheet-in"
         onClick={() => setMenuId(null)}>
      <div className="pt-1 px-7 flex justify-between items-center">
        <span className="aura-pl-eyebrow">Playlists</span>
        <button onClick={onClose} className="aura-pl-back">
          Back
        </button>
      </div>

      <div className="pt-[18px] px-7">
        <div className="font-serif text-[38px] leading-none tracking-[-0.02em]">
          Your<br/><em className="italic">playlists.</em>
        </div>
      </div>

      <div className="pt-7 px-[22px] flex flex-col gap-2">
        {/* New-playlist form: tinted, clearly distinct from playlist rows */}
        {creating ? (
          <form onSubmit={submitNew} onClick={(e) => e.stopPropagation()} className="aura-pl-create">
            <span className="aura-pl-create__eyebrow">Create a playlist</span>
            <div className="aura-pl-create__row">
              <span className="aura-pl-cover-fallback">+</span>
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
          <button onClick={(e) => { e.stopPropagation(); setCreating(true); }}
            className="aura-lib-pl-card flex items-center gap-3.5 w-full">
            <span className="aura-lib-pl-cover aura-lib-pl-cover--fallback">+</span>
            <span className="aura-pl-new-label">New playlist</span>
          </button>
        )}

        {status === 'loading' && (
          <div className="py-3">
            <span className="aura-pl-status">Loading playlists</span>
          </div>
        )}

        {status === 'error' && (
          <div className="py-4 aura-pl-status">
            Couldn’t fetch playlists — {hit.error}
          </div>
        )}

        {status === 'ok' && lists.length === 0 && !creating && (
          <div className="py-8">
            <div className="aura-pl-empty-title">
              Nothing here yet.
            </div>
            <div className="aura-pl-empty-sub">
              Tap “New playlist” above to start one.
            </div>
          </div>
        )}

        {lists.map(p => (
          <div key={p.id} className="relative">
            <button
              onClick={(e) => { e.stopPropagation(); onOpenPlaylist?.(p.id); }}
              className="aura-lib-pl-card flex items-center gap-3.5 w-full"
            >
              {p.coverImageUrl
                ? <img src={p.coverImageUrl} alt="" className="aura-lib-pl-cover" loading="lazy"/>
                : <span className="aura-lib-pl-cover aura-lib-pl-cover--fallback">
                    {p.name?.[0]?.toUpperCase() ?? '·'}
                  </span>}
              <div className="flex-1 min-w-0">
                <div className="aura-pl-row-name truncate">{p.name}</div>
                <div className="aura-pl-row-count">
                  {p.trackCount} {p.trackCount === 1 ? 'track' : 'tracks'}
                </div>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); setMenuId(m => m === p.id ? null : p.id); }}
                aria-label="More"
                className="aura-pl-overflow bg-transparent border-0 p-2 cursor-pointer text-ink-soft">
                <svg width="4" height="16" viewBox="0 0 4 16">
                  <circle cx="2" cy="3"  r="1.6" fill="currentColor"/>
                  <circle cx="2" cy="8"  r="1.6" fill="currentColor"/>
                  <circle cx="2" cy="13" r="1.6" fill="currentColor"/>
                </svg>
              </button>
            </button>
            {menuId === p.id && (
              <div className="aura-pl-menu" onClick={(e) => e.stopPropagation()}>
                <button
                  onClick={() => remove(p)}
                  className="aura-pl-menu-item aura-pl-menu-item--danger">
                  Delete
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
