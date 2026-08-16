import { useMemo, useState } from 'react';
import { resolveItem, pollImport } from '../api/ytImport';
import { COPY, copyForCode } from '../lib/ytImportCopy';
import { toast } from '../lib/toast';
import './YouTubeImportScreen.css';

// The review screen.
//
// This is not an error path, and it must not read like one. At the measured
// ~65% auto-match rate roughly a third of every import arrives here, so it is
// where a third of the result is actually decided — and the songs it holds are
// the HARD ones: covers, different recordings, transliterated titles, songs
// the catalogue spells another way. Getting these right is most of the
// difference between a playlist that feels imported and one that feels made.
//
// Three commitments, each of which costs layout:
//
//  1. Show why. Every candidate carries the parse READING that produced its
//     score — "A - B" is song-artist in Indian titles and artist-song in
//     Western ones, and the matcher scores both. Naming the winner turns an
//     arbitrary list into an explicable one.
//  2. Show enough to decide. Art, artist, album and duration, because duration
//     is very often the only thing separating a song from its own remix.
//  3. Never blame the user. A row with no candidates is the catalogue's limit,
//     not a mistake they made, and it says so.

function mmss(sec) {
  if (!Number.isFinite(sec) || sec <= 0) return null;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

// How far the candidate's length is from the video's. Shown rather than the raw
// score because "12s longer" is a fact the user can act on and "0.83" is not.
function driftLabel(candidateSec, ytSec) {
  if (!Number.isFinite(candidateSec) || !Number.isFinite(ytSec) || !ytSec) return null;
  const d = Math.round(candidateSec - ytSec);
  if (Math.abs(d) <= 3) return 'same length';
  return `${Math.abs(d)}s ${d > 0 ? 'longer' : 'shorter'}`;
}

export function YouTubeReviewScreen({ job, onDone, onOpenPlaylist }) {
  // Snapshot the queue once. Re-deriving it from `job` after every resolve
  // would make rows vanish from under the user's finger as they are answered —
  // the list must stay still while it is being worked through.
  const queue = useMemo(
    () => (job.items ?? []).filter(i => i.state === 'pending' && i.tier === 'review'),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [job.id],
  );
  const missing = useMemo(
    () => (job.items ?? []).filter(i => i.tier === 'unmatched'),
    [job.items],
  );

  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [accepted, setAccepted] = useState(0);

  const item = queue[index];
  const finished = index >= queue.length;

  const advance = () => setIndex(i => i + 1);

  const answer = async (trackId) => {
    if (busy || !item) return;
    setBusy(true);
    try {
      await resolveItem(job.id, item.id, trackId ? { trackId } : { skip: true });
      if (trackId) setAccepted(n => n + 1);
      advance();
    } catch (err) {
      const copy = copyForCode(err.code, err.message);
      toast(copy.title);
      // A candidate the server no longer recognises can't be chosen no matter
      // how many times it is tapped — move on rather than trapping the user on
      // a row they cannot answer.
      if (err.code === 'YT_NOT_OFFERED') advance();
    } finally {
      setBusy(false);
    }
  };

  const close = async () => {
    // Re-read once on the way out so the caller's summary reflects the work
    // just done, instead of the counts from before review started.
    let updated = null;
    try { updated = await pollImport(job.id); } catch { /* summary stays stale — harmless */ }
    onDone?.(updated);
  };

  return (
    <div className="absolute inset-0 bg-bg text-ink pt-5 overflow-auto pb-24 animate-aura-sheet-in">
      <div className="pt-1 px-7 flex justify-between items-center">
        <span className="aura-pl-eyebrow">
          {finished ? COPY.review.done : COPY.review.progress(Math.min(index + 1, queue.length), queue.length)}
        </span>
        <button onClick={close} className="aura-pl-back">
          {finished ? COPY.done.open : COPY.review.skipAll}
        </button>
      </div>

      {!finished && item && (
        <>
          <div className="pt-[18px] px-7">
            <div className="font-serif text-[34px] leading-[1.05] tracking-[-0.02em]">
              {COPY.review.title}
            </div>
          </div>

          <div className="pt-5 px-[22px]">
            {/* What YouTube called it, and how we read it. The second line is
                the one that makes the choice below explicable. */}
            <div className="aura-yt-source">
              <div className="aura-yt-source__title">{item.youtube?.title}</div>
              <div className="aura-yt-source__meta">
                {[item.youtube?.channel, mmss(item.youtube?.durationSec)].filter(Boolean).join(' · ')}
              </div>
              {item.candidates?.[0]?.reading && (
                <div className="aura-yt-source__read">
                  {COPY.review.readAs(
                    item.candidates[0].reading.title,
                    item.candidates[0].reading.artists?.[0] ?? null,
                  )}
                </div>
              )}
            </div>

            <div className="pt-4 flex flex-col gap-2">
              {(item.candidates ?? []).map(c => (
                <button
                  key={c.id}
                  disabled={busy}
                  onClick={() => answer(c.id)}
                  className="aura-yt-cand"
                >
                  {c.imageUrl
                    ? <img src={c.imageUrl} alt="" className="aura-pl-cover" loading="lazy"/>
                    : <span className="aura-pl-cover-fallback">{c.title?.[0]?.toUpperCase() ?? '·'}</span>}
                  <span className="flex-1 min-w-0 text-left">
                    <span className="aura-yt-cand__title">{c.title}</span>
                    <span className="aura-yt-cand__meta">
                      {/* Language first: when this screen is asking about a
                          same-titled song in two languages, it is the ONLY
                          thing separating the rows, and it belongs where the
                          eye lands rather than at the end of a run of dots. */}
                      {[c.language, c.artist, c.album, mmss(c.durationSec), driftLabel(c.durationSec, item.youtube?.durationSec)]
                        .filter(Boolean).join(' · ')}
                    </span>
                  </span>
                </button>
              ))}

              {(item.candidates ?? []).length === 0 && (
                <div className="aura-yt-note">
                  <div className="aura-yt-note__title">{COPY.review.none}</div>
                  {/* Said plainly, because the natural reading of an empty list
                      is "I did something wrong". They did not — the catalogue
                      cannot answer some queries at all. */}
                  <div className="aura-yt-note__body">{COPY.review.noneHint}</div>
                </div>
              )}
            </div>

            <div className="aura-yt-actions">
              <button onClick={() => answer(null)} disabled={busy} className="aura-yt-btn aura-yt-btn--quiet">
                {COPY.review.skip}
              </button>
            </div>
          </div>
        </>
      )}

      {finished && (
        <>
          <div className="pt-[18px] px-7">
            <div className="font-serif text-[34px] leading-[1.05] tracking-[-0.02em]">
              {COPY.review.done}
            </div>
          </div>
          <div className="pt-5 px-[22px] flex flex-col gap-3">
            <div className="aura-yt-summary">
              <div className="aura-yt-summary__headline">{COPY.done.ready(accepted)}</div>
              <div className="aura-yt-summary__line">{COPY.review.doneBody}</div>
              {missing.length > 0 && (
                <div className="aura-yt-summary__line aura-yt-summary__line--soft">
                  {COPY.done.missing(missing.length)}
                </div>
              )}
            </div>
            <div className="aura-yt-actions">
              <button
                onClick={() => (job.playlistId ? onOpenPlaylist?.(job.playlistId) : close())}
                className="aura-yt-btn aura-yt-btn--go"
              >
                {COPY.done.open}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
