import { useState } from 'react';
import './AlbumArt.css';

// AlbumArt — renders the real cover image (track.imageUrl from the catalog CDN) when
// present, otherwise a procedural fallback. Also falls back when the image
// fails to load (404 / network error) so we never show a broken-image glyph.

export function AlbumArt({ track, size = 260, radius = 6, className = '', style }) {
  const [imgFailed, setImgFailed] = useState(false);
  // Reset failure flag when the track changes so a new track's image gets tried.
  const showImage = track.imageUrl && !imgFailed;
  return (
    <div
      className={`aura-album-art ${className}`}
      style={{ '--size': `${size}px`, '--radius': `${radius}px`, ...style }}
    >
      {showImage
        ? <img key={track.imageUrl} src={track.imageUrl} alt=""
            className="aura-album-art__photo" loading="lazy" decoding="async"
            width={size} height={size}
            onError={() => setImgFailed(true)}/>
        : <CoverPattern cover={track.cover} artist={track.artist}/>}
      <div className="aura-album-art__vignette"/>
    </div>
  );
}

function CoverPattern({ cover, artist }) {
  switch (cover) {
    case 'rings':
      return (
        <>
          <div className="aura-cover-rings__bg"/>
          {[0.92, 0.74, 0.56, 0.38, 0.22].map((s, i) => (
            <div key={i}
              className="aura-cover-rings__ring"
              style={{
                '--ring-size': `${s * 100}%`,
                '--ring-color': `color-mix(in srgb, ${i % 2 === 0 ? 'var(--p2)' : 'var(--p1)'}, transparent ${i === 0 ? 75 : 62}%)`,
                '--ring-opacity': 0.65 - i * 0.08,
              }}/>
          ))}
          <div className="aura-cover-rings__core"/>
        </>
      );
    case 'bands':
      return (
        <>
          <div className="aura-cover-bands__bg"/>
          {[0.10, 0.22, 0.38, 0.58, 0.82].map((y, i) => (
            <div key={i}
              className="aura-cover-bands__band"
              style={{
                '--band-top': `${y * 100}%`,
                '--band-height': `${i % 2 === 0 ? 14 : 6}%`,
                '--band-color': i % 2 === 0 ? 'var(--p1)' : 'var(--p2)',
                '--band-opacity': i === 2 ? 0.95 : 0.65 - i * 0.06,
              }}/>
          ))}
        </>
      );
    case 'circle':
      return (
        <>
          <div className="aura-cover-circle__bg"/>
          <div className="aura-cover-circle__disc"/>
        </>
      );
    case 'split':
      return (
        <>
          <div className="aura-cover-split__bg"/>
          <div className="aura-cover-split__diag"/>
          <div className="aura-cover-split__orb"/>
        </>
      );
    case 'noise':
    default: {
      const monogram = (artist ?? '·').split(' ').map(s => s[0]).filter(Boolean).join('').toLowerCase() || '·';
      return (
        <>
          <div className="aura-cover-noise__bg"/>
          <div className="aura-cover-noise__monogram">{monogram}</div>
        </>
      );
    }
  }
}
