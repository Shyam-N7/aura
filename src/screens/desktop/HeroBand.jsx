import { useState } from 'react';
import { MonoLabel } from '../../components/primitives';
import { AlbumArt } from '../../components/album/AlbumArt';
import { cleanTitle } from '../../utils/title';

export function HeroBand({ track, djName, onPick }) {
  const [bgFailed, setBgFailed] = useState(false);
  const showBg = track.imageUrl && !bgFailed;
  return (
    <div onClick={onPick} className="aura-dh-hero-band">
      {showBg ? (
        <>
          <img src={track.imageUrl} alt="" aria-hidden loading="lazy"
            onError={() => setBgFailed(true)}
            className="aura-dh-hero-band__bg"/>
          <div className="aura-dh-hero-band__tint"/>
        </>
      ) : (
        <div className="absolute inset-0 bg-[linear-gradient(120deg,#2a221c_0%,#6b4a2b_60%,#b06a3f_130%)]"/>
      )}
      <div className="aura-dh-hero-band__art">
        <AlbumArt track={track} size={200} radius={6}/>
      </div>
      <div className="aura-dh-hero-band__copy">
        <div className="aura-dh-hero-band__top flex items-center gap-3">
          <MonoLabel className="text-white/70" size={9}>the set · tonight</MonoLabel>
          <span className="w-6 h-px bg-white/30"/>
          <MonoLabel className="text-white/70" size={9}>opens with {djName.toLowerCase()}&rsquo;s pick</MonoLabel>
        </div>
        <div className="aura-dh-hero-band__headline">
          {cleanTitle(track.title)}<span className="opacity-90">.</span>
        </div>
        <MonoLabel className="aura-dh-hero-band__artist text-white/80 mt-2" size={9.5}>
          {(track.artist ?? '').toLowerCase()}
        </MonoLabel>
        <div className="flex-1"/>
        <div className="flex items-center justify-between mt-[22px]">
          <div className="aura-dh-hero-band__opens">
            opens with {cleanTitle(track.title)} — {track.artist}
          </div>
          <div className="flex items-center gap-3">
            <button onClick={onPick} className="aura-dh-hero-band__begin">
              <span className="aura-dh-hero-band__begin-disc">
                <svg width="7" height="9" viewBox="0 0 7 9"><path d="M0 0 L7 4.5 L0 9 Z" fill="currentColor"/></svg>
              </span>
              begin the set
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
