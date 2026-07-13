import { useEffect, useRef, useState } from 'react';
import { listPlaylists, createPlaylist, deletePlaylist, acceptPlaylistInvite, removePlaylistCollaborator, listSavedPlaylists } from '../api/playlists';
import { listAutoPlaylists } from '../api/autoPlaylists';
import { getUser } from '../lib/auth';
import { toast } from '../lib/toast';
import { confirm } from '../lib/confirm';
import { AnchoredMenu } from '../components/AnchoredMenu';
import { TapHint } from '../components/TapHint';
import { killHint } from '../lib/tapHint';
import { useScrollMemory } from '../hooks/useScrollMemory';
import { BackToTop } from '../components/BackToTop';
import { relTime } from '../utils/relTime';
import './PlaylistsScreen.css';

// Why home sometimes shows fewer mixes than this screen: home windows the
// daypart mixes to their own local hours; here the full suite always shows,
// with these captions doing the explaining.
const DAYPART_NOTE = {
  morning: 'on home in the morning',
  night: 'on home after 8pm',
};

export function PlaylistsScreen({ onClose, onOpenPlaylist, onOpenAuto, onPlaySequence }) {
  const [hit, setHit]       = useState({ data: null, error: null });
  const [auto, setAuto]     = useState([]);
  const [savedLists, setSavedLists] = useState([]);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName]   = useState('');
  const [menu, setMenu]         = useState(null);
  const inputRef = useRef(null);
  const status = hit.error ? 'error' : hit.data ? 'ok' : 'loading';
  const scrollRef = useScrollMemory('playlists', { ready: status === 'ok' });

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

  // Smart sets from the user's listening (read-only). Best-effort: if it fails or
  // there's not enough history, the shelf just doesn't render.
  useEffect(() => {
    const ctl = new AbortController();
    listAutoPlaylists({ signal: ctl.signal })
      .then(setAuto)
      .catch(() => { /* non-fatal — hide the shelf */ });
    return () => ctl.abort();
  }, []);

  // Playlists you saved from someone else (best-effort; empty group just hides).
  useEffect(() => {
    const ctl = new AbortController();
    listSavedPlaylists({ signal: ctl.signal })
      .then(setSavedLists)
      .catch(() => { /* non-fatal */ });
    return () => ctl.abort();
  }, []);

  useEffect(() => {
    if (creating) inputRef.current?.focus();
  }, [creating]);

  // Accept a share link (?join=TOKEN) — opened from a collaborator's invite.
  // Strip the param first so a refresh can't re-run it, then join + open.
  useEffect(() => {
    let token;
    try { token = new URLSearchParams(window.location.search).get('join'); } catch { token = null; }
    if (!token) return;
    try {
      const u = new URL(window.location.href);
      u.searchParams.delete('join');
      window.history.replaceState(null, '', u.pathname + u.search);
    } catch { /* ignore */ }
    acceptPlaylistInvite(token)
      .then(({ playlistId, name, inviterName }) => {
        const label = name ? `“${name}”` : 'the playlist';
        toast(inviterName ? `Joined ${label} — shared by ${inviterName}.` : `Joined ${label}.`);
        listPlaylists().then(data => setHit({ data, error: null })).catch(() => {});
        onOpenPlaylist?.(playlistId);
      })
      .catch(err => toast(err.message));
    // run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submitNew = async (e) => {
    e?.preventDefault?.();
    const name = newName.trim();
    if (!name) { setCreating(false); setNewName(''); return; }
    try {
      const playlist = await createPlaylist({ name });
      setHit(h => ({ ...h, data: [playlist, ...(h.data ?? [])] }));
      toast('playlist created.');
      setNewName('');
      setCreating(false);
    } catch (err) {
      toast(`Couldn’t create — ${err.message}`);
    }
  };

  const remove = async (playlist) => {
    setMenu(null);
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
      toast('playlist deleted.');
    } catch (err) {
      toast(`Couldn’t delete — ${err.message}`);
    }
  };

  // Collaborator leaving a shared playlist (owners use Delete instead).
  const leave = async (playlist) => {
    setMenu(null);
    const me = getUser();
    if (!me?.id) return;
    const ok = await confirm({
      title: `Leave “${playlist.name}”?`,
      body:  'You’ll lose access until you’re invited again.',
      confirmLabel: 'Leave',
      danger: true,
    });
    if (!ok) return;
    try {
      await removePlaylistCollaborator(playlist.id, me.id);
      setHit(h => ({ ...h, data: (h.data ?? []).filter(p => p.id !== playlist.id) }));
      toast('left the playlist.');
    } catch (err) {
      toast(`Couldn’t leave — ${err.message}`);
    }
  };

  const lists = hit.data ?? [];
  // Two groups: sets YOU own (incl. a shared list you started) vs sets you were
  // invited into. The API returns one flat array; partition it for the headings.
  const owned  = lists.filter(p => !p.shared || p.role === 'owner');
  const joined = lists.filter(p => p.shared && p.role !== 'owner');

  const renderRow = (p) => (
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
          <div className="aura-pl-row-count truncate">
            {p.trackCount} {p.trackCount === 1 ? 'track' : 'tracks'}
            {p.shared && ` · ${p.role === 'owner' ? 'shared' : 'shared with you'}`}
            {p.updatedAt ? ` · updated ${relTime(p.updatedAt)}` : ''}
          </div>
        </div>
        <button
          onClick={(e) => { e.stopPropagation(); const el = e.currentTarget; setMenu(m => m?.id === p.id ? null : { id: p.id, el }); }}
          aria-label="More"
          className="aura-pl-overflow bg-transparent border-0 p-2 cursor-pointer text-ink-soft">
          <svg width="4" height="16" viewBox="0 0 4 16">
            <circle cx="2" cy="3"  r="1.6" fill="currentColor"/>
            <circle cx="2" cy="8"  r="1.6" fill="currentColor"/>
            <circle cx="2" cy="13" r="1.6" fill="currentColor"/>
          </svg>
        </button>
      </button>
      {menu?.id === p.id && (
        <AnchoredMenu anchorEl={menu.el} onClose={() => setMenu(null)} estHeight={52}>
          {p.role === 'owner' ? (
            <button onClick={() => remove(p)} className="aura-pl-menu-item aura-pl-menu-item--danger">
              Delete
            </button>
          ) : (
            <button onClick={() => leave(p)} className="aura-pl-menu-item aura-pl-menu-item--danger">
              Leave
            </button>
          )}
        </AnchoredMenu>
      )}
    </div>
  );

  return (
    <div ref={scrollRef} className="absolute inset-0 bg-bg text-ink pt-5 overflow-auto pb-24 animate-aura-sheet-in"
         onClick={() => setMenu(null)}>
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

      {/* Made-for-you mixes — read-only, built from listening history. Tapping the
          card OPENS the set (like a normal playlist); the ▶ plays it directly.
          Unlike Home (which windows the daypart mixes), the full suite shows here —
          the DAYPART_NOTE caption explains why home sometimes shows fewer; a gate
          card is informational only. */}
      {auto.length > 0 && (
        <div className="pt-6 px-[22px]">
          <span className="aura-pl-eyebrow aura-pl-auto-eyebrow">Made for you</span>
          <div className="pt-2.5 flex flex-col gap-2">
            {auto.map(a => a.kind === 'auto-gate' ? (
              <div key={a.id}
                className="aura-lib-pl-card aura-pl-auto-card flex items-center gap-3.5 w-full opacity-55">
                <span className="aura-lib-pl-cover aura-lib-pl-cover--fallback">♫</span>
                <div className="flex-1 min-w-0">
                  <div className="aura-pl-row-name truncate">{a.name}</div>
                  <div className="aura-pl-row-count truncate">{a.gate?.line}</div>
                </div>
              </div>
            ) : (
              <button key={a.id} onClick={() => onOpenAuto?.(a)}
                className="aura-lib-pl-card aura-pl-auto-card flex items-center gap-3.5 w-full">
                {a.coverImageUrl
                  ? <img src={a.coverImageUrl} alt="" className="aura-lib-pl-cover" loading="lazy"/>
                  : <span className="aura-lib-pl-cover aura-lib-pl-cover--fallback">♫</span>}
                <div className="flex-1 min-w-0">
                  <div className="aura-pl-row-name truncate">{a.name}</div>
                  <div className="aura-pl-row-count truncate">
                    {(a.editionLabel ?? a.description)
                      + (a.cadence ? ` · ${a.cadence}` : '')
                      + (a.refreshing ? ' · refreshing…' : '')
                      + (DAYPART_NOTE[a.mixKey] ? ` · ${DAYPART_NOTE[a.mixKey]}` : '')}
                  </div>
                </div>
                <span
                  role="button" tabIndex={0} aria-label={`play ${a.name}`}
                  onClick={(e) => { e.stopPropagation(); onPlaySequence?.(a.tracks, 0, a.name); }}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onPlaySequence?.(a.tracks, 0, a.name); } }}
                  className="aura-pl-auto-play">
                  <svg width="13" height="13" viewBox="0 0 13 13"><path d="M3 2 L11 6.5 L3 11 Z" fill="currentColor"/></svg>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Made by you — the sets you started (incl. a shared list you own), plus
          the create entry point and the fetch/empty states. */}
      <div className="pt-7 px-[22px]">
        <span className="aura-pl-eyebrow aura-pl-auto-eyebrow">Made by you</span>
        <div className="pt-2.5 flex flex-col gap-2">
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
            <div className="relative">
              <button onClick={(e) => { e.stopPropagation(); killHint('newPlaylist'); setCreating(true); }}
                className="aura-lib-pl-card flex items-center gap-3.5 w-full">
                <span className="aura-lib-pl-cover aura-lib-pl-cover--fallback">+</span>
                <span className="aura-pl-new-label">New playlist</span>
              </button>
              {/* First-playlist nudge — only while the user owns nothing. */}
              <TapHint id="newPlaylist" label="start your first playlist" placement="inside"
                show={status === 'ok' && owned.length === 0 && !creating}/>
            </div>
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

          {status === 'ok' && owned.length === 0 && !creating && (
            <div className="py-8">
              <div className="aura-pl-empty-title">
                nothing here yet.
              </div>
              <div className="aura-pl-empty-sub">
                tap “new playlist” above to start one.
              </div>
            </div>
          )}

          {owned.map(renderRow)}
        </div>
      </div>

      {/* Shared with you — sets a friend invited you into. Hidden entirely when
          you haven't joined any, so the heading never sits over an empty list. */}
      {joined.length > 0 && (
        <div className="pt-7 px-[22px]">
          <span className="aura-pl-eyebrow aura-pl-auto-eyebrow">Shared with you</span>
          <div className="pt-2.5 flex flex-col gap-2">
            {joined.map(renderRow)}
          </div>
        </div>
      )}

      {/* Saved — playlists you kept from someone else (not editable). An owner
          who unshares one leaves it here, marked "no longer shared". */}
      {savedLists.length > 0 && (
        <div className="pt-7 px-[22px]">
          <span className="aura-pl-eyebrow aura-pl-auto-eyebrow">Saved</span>
          <div className="pt-2.5 flex flex-col gap-2">
            {savedLists.map(p => (
              <button key={p.id} type="button"
                onClick={() => p.accessible && onOpenPlaylist?.(p.id)}
                disabled={!p.accessible}
                className={`aura-lib-pl-card flex items-center gap-3.5 w-full${p.accessible ? '' : ' opacity-55'}`}>
                {p.coverImageUrl
                  ? <img src={p.coverImageUrl} alt="" className="aura-lib-pl-cover" loading="lazy"/>
                  : <span className="aura-lib-pl-cover aura-lib-pl-cover--fallback">{p.name?.[0]?.toUpperCase() ?? '·'}</span>}
                <div className="flex-1 min-w-0 text-left">
                  <div className="aura-pl-row-name truncate">{p.name}</div>
                  <div className="aura-pl-row-count truncate">
                    {p.accessible
                      ? `${p.trackCount} ${p.trackCount === 1 ? 'track' : 'tracks'}${p.ownerName ? ` · by ${p.ownerName}` : ''}`
                      : 'no longer shared'}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
      <BackToTop scrollRef={scrollRef}/>
    </div>
  );
}
