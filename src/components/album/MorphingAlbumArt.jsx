import { useState, useEffect } from 'react';
import { AlbumArt } from './AlbumArt';
import './MorphingAlbumArt.css';

export function MorphingAlbumArt({ track, size, radius, style }) {
  const [prev, setPrev] = useState(null);
  const [current, setCurrent] = useState(track);
  useEffect(() => {
    if (track.id !== current.id) {
      // Intentional crossfade — capture previous track on id change for the fade-out layer.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPrev(current);
      setCurrent(track);
      const id = setTimeout(() => setPrev(null), 900);
      return () => clearTimeout(id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track.id]);
  return (
    <div className="aura-morphing-art" style={{ '--size': `${size}px`, ...style }}>
      {prev && (
        <div key={prev.id+'-out'} className="aura-morphing-art__layer aura-morphing-art__layer--out">
          <AlbumArt track={prev} size={size} radius={radius}/>
        </div>
      )}
      <div key={current.id+'-in'}
        className={`aura-morphing-art__layer ${prev ? 'aura-morphing-art__layer--in' : ''}`}>
        <AlbumArt track={current} size={size} radius={radius}/>
      </div>
    </div>
  );
}
