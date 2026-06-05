import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './src/styles/global.css';
import './src/styles/animations.css';
import './src/styles/responsive.css';
import { MobilePlayer } from './src/screens/mobile/MobilePlayer';

const track = { id: 'demo1', title: 'Ishq Wala Love', artist: 'Vishal & Shekhar', durationSec: 218, imageUrl: '', album: 'Student of the Year' };
const nextTrack = { id: 'demo2', title: 'O Sona', artist: 'A. R. Rahman', durationSec: 240, imageUrl: '' };

const mockPlayer = {
  _vol: 0.7, _muted: false,
  isMuted() { return this._muted; },
  getVolume() { return this._vol; },
  setVolume(v) { this._vol = v; },
  setMuted(m) { this._muted = m; },
  on() { return () => {}; },
};

function rect(sel) {
  const el = document.querySelector(sel);
  if (!el) return `${sel}: MISSING`;
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  return `${sel}: x=${Math.round(r.left)},${Math.round(r.right)} y=${Math.round(r.top)},${Math.round(r.bottom)} wh=${Math.round(r.width)}x${Math.round(r.height)} disp=${cs.display} vis=${cs.visibility} op=${cs.opacity} tf=${cs.transform.slice(0,18)}`;
}

function Debug() {
  const [info, setInfo] = useState('measuring…');
  useEffect(() => {
    const id = setTimeout(() => {
      setInfo([
        `win=${window.innerWidth}x${window.innerHeight}`,
        rect('.aura-mp'),
        rect('.aura-mp__content'),
        rect('.aura-mp__vol'),
        rect('.aura-vol__slider'),
      ].join('\n'));
    }, 500);
    return () => clearTimeout(id);
  }, []);
  return (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 99999, background: '#000', color: '#0f0', font: '10px monospace', padding: '3px 5px', whiteSpace: 'pre-wrap' }}>
      {info}
    </div>
  );
}

function Harness() {
  return (
    <div className="aura-responsive-shell aura-responsive-shell--mobile theme-dusk">
      <div className="aura-responsive-shell__stage">
        <div className="absolute inset-0">
          <div className="absolute inset-0 animate-aura-screen-in">
            <MobilePlayer
              track={track} nextTrack={nextTrack} player={mockPlayer}
              progress={0.26} playing={true} mood="calm" djName="AURA"
              repeatMode="off" onCycleRepeat={() => {}} onShuffle={() => {}} shuffleActive={false}
              onTogglePlay={() => {}} onPrev={() => {}} onNext={() => {}} onSeek={() => {}}
              onBack={() => {}} openWhy={() => {}} openLyrics={() => {}} openQueue={() => {}}
            />
          </div>
        </div>
      </div>
      <Debug />
    </div>
  );
}

createRoot(document.getElementById('root')).render(<Harness />);
