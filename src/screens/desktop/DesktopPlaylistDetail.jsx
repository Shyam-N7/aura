import { useEffect, useRef, useState } from 'react';
import { MonoLabel } from '../../components/primitives';
import { AlbumArt } from '../../components/album/AlbumArt';
import { Avatar } from '../../components/Avatar';
import { AuraLoader } from '../../components/feedback/AuraLoader';
import { getPlaylist, removeFromPlaylist, getPlaylistRev, createPlaylistInvite, setPlaylistVisibility, removePlaylistCollaborator, setPlaylistOnlyMe, setPlaylistCover } from '../../api/playlists';
import { fmtTime, fmtRuntime } from '../../utils/fmtTime';
import { relTime } from '../../lib/time';
import { cleanTitle } from '../../utils/title';
import { toast } from '../../lib/toast';
import { confirm } from '../../lib/confirm';
import { getUser } from '../../lib/auth';
import { uploadImage } from '../../api/uploads';
import { toggleTrackMenu } from '../../lib/trackContextMenu';
import { AnchoredMenu } from '../../components/AnchoredMenu';
import { CrumbBack } from './CrumbBack';
import { useScrollMemory } from '../../hooks/useScrollMemory';
import { BackToTop } from '../../components/BackToTop';
import '../PlaylistsScreen.css'; // .aura-pl-menu-item (AnchoredMenu items)
import './DesktopPlaylistDetail.css';

// A playlist is in exactly one of three visible states, worn as the Share
// button's icon + label so the owner always sees who can see it: a lock for
// private, an overlapping-people mark for invited-only, a globe for a public
// link. (Public wins the label when both a link and collaborators exist.)
const VIS_ICON = {
  private: (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="3.5" y="7.2" width="9" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.3"/>
      <path d="M5.6 7.2 V5.3 a2.4 2.4 0 0 1 4.8 0 V7.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
    </svg>
  ),
  shared: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="6" cy="5.6" r="2.3" stroke="currentColor" strokeWidth="1.3"/>
      <path d="M2.2 13 c0 -2.4 1.9 -3.9 3.8 -3.9 s3.8 1.5 3.8 3.9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
      <path d="M11 4.2 a2.1 2.1 0 0 1 0 4.1 M11.6 9.3 c1.7 0.3 2.8 1.6 2.8 3.6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
    </svg>
  ),
  public: (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="5.6" stroke="currentColor" strokeWidth="1.3"/>
      <path d="M2.6 8 H13.4 M8 2.4 c2.1 2.4 2.1 8.8 0 11.2 M8 2.4 c-2.1 2.4 -2.1 8.8 0 11.2" stroke="currentColor" strokeWidth="1.1"/>
    </svg>
  ),
};
const VIS_LABEL = { private: 'Private', shared: 'Shared', public: 'Public' };
const CheckMark = () => (
  <svg className="aura-vis-check" width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M3.5 8.5 L6.5 11.5 L12.5 4.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

export function DesktopPlaylistDetail({ playlistId, onClose, onPlaySequence }) {
  const [hit, setHit]     = useState({ data: null, error: null });
  const [shareEl, setShareEl] = useState(null);   // Share button → options menu anchor
  const [shareBusy, setShareBusy] = useState(false); // public-link toggle in flight
  const [coverPicking, setCoverPicking] = useState(false);   // cover-picker sheet open
  const [membersOpen, setMembersOpen] = useState(false);     // "who has access" sheet open
  const status = hit.error ? 'error' : hit.data ? 'ok' : 'loading';
  const scrollRef = useScrollMemory(`playlist:${playlistId}`, { ready: status === 'ok' });

  useEffect(() => {
    const ctl = new AbortController();
    getPlaylist(playlistId, { signal: ctl.signal })
      .then(data => setHit({ data, error: null }))
      .catch(err => {
        if (err.name === 'AbortError') return;
        setHit({ data: null, error: err.message });
      });
    return () => ctl.abort();
  }, [playlistId]);

  const tracks = hit.data?.tracks ?? [];
  const myId = getUser()?.id;
  const canEdit = hit.data?.canEdit ?? false;
  const isOwner = hit.data?.role === 'owner';
  const shared = hit.data?.shared ?? false;
  const collaborators = hit.data?.collaborators ?? [];
  // Caption beside the avatar cluster: name + role for one, names (+overflow)
  // for several.
  const collabCaption = collaborators.length === 1
    ? `${collaborators[0].name} · can ${collaborators[0].role === 'viewer' ? 'view' : 'edit'}`
    : `${collaborators.slice(0, 2).map(c => c.name).join(', ')}${collaborators.length > 2 ? ` +${collaborators.length - 2} more` : ''}`;
  const updatedAt = hit.data?.updatedAt;
  const isPublic = hit.data?.isPublic ?? false;
  const publicId = hit.data?.publicId ?? null;
  const coverImageUrl = hit.data?.coverImageUrl ?? null;
  // The playlist's current reach — public link beats invited-only beats private.
  const visibility = isPublic ? 'public' : collaborators.length ? 'shared' : 'private';

  // Set the cover to a chosen track's art (owner/editor). Optimistic.
  const chooseCover = async (t) => {
    setCoverPicking(false);
    if (t.id === undefined) return;
    const prev = hit.data;
    setHit(h => ({ ...h, data: { ...h.data, coverImageUrl: t.imageUrl ?? h.data.coverImageUrl } }));
    try {
      await setPlaylistCover(playlistId, { trackId: t.id });
      toast('Cover updated.');
    } catch (err) {
      setHit({ data: prev, error: null });
      toast(`Couldn’t set cover — ${err.message}`);
    }
  };

  // Upload a custom cover image (resized client-side → Blob → set as cover).
  const coverFileRef = useRef(null);
  const uploadCover = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setCoverPicking(false);
    try {
      toast('Uploading cover…');
      const { url } = await uploadImage(file, { kind: 'cover' });
      const { coverImageUrl } = await setPlaylistCover(playlistId, { imageUrl: url });
      setHit(h => ({ ...h, data: { ...h.data, coverImageUrl } }));
      toast('Cover updated.');
    } catch (err) {
      toast(`Couldn’t upload — ${err.message}`);
    }
  };

  // Live sync for shared playlists — poll the cheap rev cursor while the screen
  // is open + visible, and refetch the full playlist when a collaborator changed
  // it. Cleared on unmount; skips while the tab is hidden.
  useEffect(() => {
    if (!shared) return undefined;
    let stop = false;
    const tick = async () => {
      if (stop || document.hidden) return;
      try {
        const { updatedAt: rev } = await getPlaylistRev(playlistId);
        if (stop || !rev || rev === updatedAt) return;
        const data = await getPlaylist(playlistId);
        if (!stop) setHit({ data, error: null });
      } catch { /* transient — next tick retries */ }
    };
    const id = setInterval(tick, 15000);
    return () => { stop = true; clearInterval(id); };
  }, [playlistId, shared, updatedAt]);

  // ── View-only public link (anyone with it can open, no account needed) ──
  const publicLink = (pid) => `${window.location.origin}/p/${pid}`;
  const togglePublic = async () => {
    if (shareBusy) return;
    setShareBusy(true);
    try {
      const { isPublic: nowPublic, publicId: pid } = await setPlaylistVisibility(playlistId, !isPublic);
      setHit(h => ({ ...h, data: { ...h.data, isPublic: nowPublic, publicId: pid } }));
      if (nowPublic) {
        const link = publicLink(pid);
        try { await navigator.clipboard.writeText(link); toast('Public view link copied — anyone can open it.'); }
        catch { toast(link); }
      } else {
        toast('Public link is off.');
      }
    } catch (err) {
      toast(`Couldn’t update — ${err.message}`);
    } finally {
      setShareBusy(false);
    }
  };
  const copyPublicLink = async () => {
    setShareEl(null);
    const link = publicLink(publicId);
    try { await navigator.clipboard.writeText(link); toast('View link copied — anyone can open it.'); }
    catch { toast(link); }
  };

  // ── Invite links (recipient signs in, then can edit OR just view) ──
  const makeShareLink = async (role) => {
    const { token } = await createPlaylistInvite(playlistId, role ? { role } : {});
    return `${window.location.origin}/playlists?join=${token}`;
  };
  const copyInviteLink = (role, done) => async () => {
    setShareEl(null);
    try {
      const link = await makeShareLink(role);
      try { await navigator.clipboard.writeText(link); toast(done); }
      catch { toast(link); }
    } catch (err) {
      toast(`Couldn’t create a link — ${err.message}`);
    }
  };
  const copyShareLink = copyInviteLink('editor', 'Edit-invite link copied — they can edit after signing in.');
  const copyViewInvite = copyInviteLink('viewer', 'View-invite link copied — they can view after signing in.');

  // "Only you" — the hard-private revert. Spell out exactly what it severs.
  const makeOnlyMe = async () => {
    setShareEl(null);
    const bits = [];
    if (collaborators.length) bits.push(`${collaborators.length} ${collaborators.length === 1 ? 'collaborator' : 'collaborators'} lose access`);
    bits.push('any pending invite links stop working');
    if (isPublic) bits.push('the public link turns off');
    const ok = await confirm({
      title: 'Make this only you?',
      body: `${bits.join(', ')}. You can share it again anytime.`,
      confirmLabel: 'make private',
      danger: true,
    });
    if (!ok) return;
    const prev = hit.data;
    setHit(h => ({ ...h, data: { ...h.data, collaborators: [], isPublic: false, shared: false } }));
    try {
      await setPlaylistOnlyMe(playlistId);
      toast('Only you can see this now.');
    } catch (err) {
      setHit({ data: prev, error: null });
      toast(`Couldn’t update — ${err.message}`);
    }
  };

  // Owner removes a collaborator by tapping their chip (with a confirm).
  const dropCollaborator = async (c) => {
    const ok = await confirm({
      title: `Remove ${c.name}?`,
      body:  'They lose access to this playlist. You can re-invite them anytime.',
      confirmLabel: 'remove',
      danger: true,
    });
    if (!ok) return;
    const prev = hit.data;
    setHit(h => ({ ...h, data: { ...h.data, collaborators: h.data.collaborators.filter(x => x.userId !== c.userId) } }));
    try {
      await removePlaylistCollaborator(playlistId, c.userId);
      toast(`Removed ${c.name}.`);
    } catch (err) {
      setHit({ data: prev, error: null });
      toast(`Couldn’t remove — ${err.message}`);
    }
  };
  const shareVia = async () => {
    setShareEl(null);
    try {
      const link = await makeShareLink();
      await navigator.share({ title: hit.data.name, text: `Join my playlist “${hit.data.name}” on AURA`, url: link });
    } catch (err) {
      if (err?.name !== 'AbortError') toast(`Couldn’t share — ${err.message}`);
    }
  };

  const remove = async (track) => {
    const ok = await confirm({
      title: `Remove “${track.title}”?`,
      body:  'This only removes it from this playlist. Your likes are untouched.',
      confirmLabel: 'remove',
      danger: true,
    });
    if (!ok) return;
    const prev = hit.data;
    setHit(h => ({
      ...h,
      data: { ...h.data, tracks: h.data.tracks.filter(t => t.id !== track.id), trackCount: h.data.trackCount - 1 },
    }));
    try {
      await removeFromPlaylist(playlistId, track.id);
      toast('Removed.');
    } catch (err) {
      setHit({ data: prev, error: null });
      toast(`Couldn’t remove — ${err.message}`);
    }
  };

  const playAll = () => {
    if (tracks.length) onPlaySequence(tracks, 0, (hit.data?.name ?? 'this playlist').toLowerCase());
  };

  return (
    <div ref={scrollRef} className="aura-dpd">
      <div className="aura-dpd__header">
        <div className="flex items-center gap-3.5">
          <CrumbBack onClick={onClose}/>
        </div>

        {status === 'loading' && (
          <AuraLoader label="Loading playlist"/>
        )}
        {status === 'error' && (
          <div className="aura-dpd__error">
            This playlist is private or unavailable. If someone shared it, ask them for a public view link.
          </div>
        )}
        {status === 'ok' && (
          <>
            <div className="aura-dpd__cover">
              {coverImageUrl
                ? <AlbumArt track={{ imageUrl: coverImageUrl, title: hit.data.name }} radius={12} style={{ width: '100%', height: '100%' }}/>
                : <span className="aura-dpd__cover-fallback">{hit.data.name?.[0]?.toUpperCase() ?? '♪'}</span>}
              {canEdit && tracks.length > 0 && (
                <button type="button" className="aura-dpd__cover-edit" onClick={() => setCoverPicking(true)}>
                  change cover
                </button>
              )}
            </div>
            <div className="aura-dpd__kind">playlist{shared ? ' · shared' : ''}</div>
            <h1 className="aura-dpd__hero">{hit.data.name}</h1>
            <div className="aura-dpd__by">
              {isOwner ? 'by you' : `by ${hit.data.ownerName ?? 'someone'}`}
              {updatedAt ? ` · updated ${relTime(updatedAt)}` : ''}
            </div>
            {collaborators.length > 0 && (
              <button type="button" className="aura-dpd__collabs" onClick={() => setMembersOpen(true)}
                aria-label="who has access">
                <div className="aura-dpd__collab-cluster">
                  {collaborators.slice(0, 5).map(c => (
                    <span key={c.userId} className="aura-dpd__collab-av"><Avatar user={c} size={26}/></span>
                  ))}
                  {collaborators.length > 5 && (
                    <span className="aura-dpd__collab-av aura-dpd__collab-av--more">+{collaborators.length - 5}</span>
                  )}
                </div>
                <span className="aura-dpd__collab-cap">{collabCaption}</span>
              </button>
            )}
            <div className="aura-dpd__actions">
              {tracks.length > 0 && (
                <button onClick={playAll} className="aura-dpd__play-all">
                  <span className="aura-dpd__play-disc">
                    <svg width="10" height="12" viewBox="0 0 12 14">
                      <path d="M0 0 L12 7 L0 14 Z" fill="currentColor"/>
                    </svg>
                  </span>
                  Play all
                </button>
              )}
              {isOwner && (
                <>
                  <button type="button"
                    onClick={(e) => { e.stopPropagation(); const el = e.currentTarget; setShareEl(s => s ? null : el); }}
                    className={`aura-dpd__share aura-dpd__share--${visibility}`}
                    aria-label={`${VIS_LABEL[visibility].toLowerCase()} — change who can see this`}>
                    {VIS_ICON[visibility]}
                    {VIS_LABEL[visibility]}
                  </button>
                  {shareEl && (
                    <AnchoredMenu anchorEl={shareEl} onClose={() => setShareEl(null)} estHeight={300}>
                      <div className="aura-pl-menu-label">who can see this</div>

                      {/* "only you" is always here — checked when it's the current
                          state (so you can see you're private) and the way back to
                          private from any shared state. */}
                      <button onClick={makeOnlyMe} disabled={visibility === 'private'}
                        className="aura-pl-menu-item aura-vis-item">
                        <span className="aura-vis-ico">{VIS_ICON.private}</span>
                        <span className="aura-vis-main">only you<span className="aura-vis-note">just for you</span></span>
                        {visibility === 'private' && <CheckMark/>}
                      </button>

                      <div className="aura-pl-menu-sub aura-vis-head">
                        people you invite{collaborators.length > 0 && <CheckMark/>}
                      </div>
                      <button onClick={copyShareLink} className="aura-pl-menu-item">copy edit-invite link</button>
                      <button onClick={copyViewInvite} className="aura-pl-menu-item">copy view-invite link</button>
                      {typeof navigator !== 'undefined' && navigator.share && (
                        <button onClick={shareVia} className="aura-pl-menu-item">invite someone…</button>
                      )}

                      <div className="aura-pl-menu-sub aura-vis-head">
                        anyone with the link{isPublic && <CheckMark/>}
                      </div>
                      <button onClick={togglePublic} disabled={shareBusy} className="aura-pl-menu-item">
                        {isPublic ? 'turn off public link' : 'make a public view link'}
                      </button>
                      {isPublic && publicId && (
                        <button onClick={copyPublicLink} className="aura-pl-menu-item">copy public link</button>
                      )}
                    </AnchoredMenu>
                  )}
                </>
              )}
            </div>
          </>
        )}
      </div>

      <div className="aura-dpd__scroll">
        {status === 'ok' && tracks.length === 0 && (
          <div className="aura-dpd__empty">
            <div className="aura-dpd__empty-title">No tracks yet.</div>
            <div className="aura-dpd__empty-body">
              Tap the music-note icon on any song to add it here.
            </div>
          </div>
        )}

        {status === 'ok' && tracks.length > 0 && (
          <div className="aura-dpd__list">
            <div className="aura-dpd__count">
              <span>{tracks.length} {tracks.length === 1 ? 'track' : 'tracks'}</span>-
              <span>{fmtRuntime(tracks.reduce((s, t) => s + (t.durationSec || 0), 0))}</span>
            </div>
            {tracks.map((t, i) => (
              <div key={t.id} className="aura-dpd__row">
                <div className="aura-dpd__idx">{String(i + 1).padStart(2, '0')}</div>
                <button onClick={(e) => onPlaySequence(tracks, i, (hit.data?.name ?? '').toLowerCase(), e.currentTarget)}
                  className="aura-dpd__main">
                  <AlbumArt track={t} size={54} radius={4}/>
                  <div className="flex-1 min-w-0">
                    <div className="aura-dpd__title">{cleanTitle(t.title)}</div>
                    <MonoLabel className="text-ink-soft mt-1.5 block truncate" size={9.5}>
                      {(t.artist ?? '').toLowerCase()} · {t.language ?? ''}
                    </MonoLabel>
                    {shared && t.addedBy && (
                      <MonoLabel className="text-ink-faint mt-1 block truncate" size={8.5}>
                        added by {t.addedBy.userId === myId ? 'you' : t.addedBy.name}
                      </MonoLabel>
                    )}
                  </div>
                  <MonoLabel className="text-ink-faint shrink-0 ml-4" size={10} numeric>{fmtTime(t.durationSec)}</MonoLabel>
                </button>
                <button type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    const r = e.currentTarget.getBoundingClientRect();
                    toggleTrackMenu({
                      track: t, x: r.right, y: r.bottom,
                      menu: { extras: canEdit ? [{ label: 'remove from this playlist', danger: true, onClick: () => remove(t) }] : [] },
                    });
                  }}
                  aria-label="more" data-track-menu-trigger
                  className="aura-dpd__more">
                  <svg width="4" height="16" viewBox="0 0 4 16">
                    <circle cx="2" cy="3"  r="1.6" fill="currentColor"/>
                    <circle cx="2" cy="8"  r="1.6" fill="currentColor"/>
                    <circle cx="2" cy="13" r="1.6" fill="currentColor"/>
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
      <BackToTop scrollRef={scrollRef}/>

      {/* Members sheet — who has access: the owner + every collaborator, their
          role and when they joined; the owner can remove someone here. */}
      {membersOpen && (
        <div className="aura-dpd__members" onClick={() => setMembersOpen(false)}>
          <div className="aura-dpd__members-panel" onClick={(e) => e.stopPropagation()}
            role="dialog" aria-label="who has access">
            <div className="aura-dpd__members-head">
              <span>who has access</span>
              <button type="button" onClick={() => setMembersOpen(false)} aria-label="close">×</button>
            </div>
            <div className="aura-dpd__members-list">
              <div className="aura-dpd__member">
                <Avatar user={{ name: hit.data.ownerName, avatarUrl: hit.data.ownerAvatarUrl }} size={38}/>
                <span className="aura-dpd__member-text">
                  <span className="aura-dpd__member-name">{isOwner ? 'you' : (hit.data.ownerName ?? 'someone')}</span>
                  <span className="aura-dpd__member-sub">owner</span>
                </span>
              </div>
              {collaborators.map(c => (
                <div key={c.userId} className="aura-dpd__member">
                  <Avatar user={c} size={38}/>
                  <span className="aura-dpd__member-text">
                    <span className="aura-dpd__member-name">{c.userId === myId ? 'you' : c.name}</span>
                    <span className="aura-dpd__member-sub">
                      can {c.role === 'viewer' ? 'view' : 'edit'}{c.joinedAt ? ` · joined ${relTime(c.joinedAt)}` : ''}
                    </span>
                  </span>
                  {isOwner && c.userId !== myId && (
                    <button type="button" className="aura-dpd__member-remove"
                      onClick={() => dropCollaborator(c)}>remove</button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Cover picker — choose any track's art as the playlist cover. */}
      {coverPicking && (
        <div className="aura-dpd__cover-picker" onClick={() => setCoverPicking(false)}>
          <div className="aura-dpd__cover-picker-panel" onClick={(e) => e.stopPropagation()}
            role="dialog" aria-label="choose a cover">
            <div className="aura-dpd__cover-picker-head">
              <span>choose a cover</span>
              <button type="button" onClick={() => setCoverPicking(false)} aria-label="close">×</button>
            </div>
            <button type="button" className="aura-dpd__cover-upload" onClick={() => coverFileRef.current?.click()}>
              + upload your own image
            </button>
            <input ref={coverFileRef} type="file" accept="image/jpeg,image/png,image/webp"
              onChange={uploadCover} hidden/>
            <div className="aura-dpd__cover-picker-sub">or pick from this playlist</div>
            <div className="aura-dpd__cover-picker-grid">
              {tracks.map(t => (
                <button key={t.id} type="button" className="aura-dpd__cover-opt"
                  onClick={() => chooseCover(t)} title={cleanTitle(t.title)}>
                  <AlbumArt track={t} radius={8} style={{ width: '100%', height: '100%' }}/>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
