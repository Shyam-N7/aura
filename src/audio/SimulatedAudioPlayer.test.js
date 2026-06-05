import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SimulatedAudioPlayer } from './SimulatedAudioPlayer';

describe('SimulatedAudioPlayer', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('starts at progress 0 after load()', async () => {
    const player = new SimulatedAudioPlayer();
    await player.load({ id: 't1', durationSec: 100 });
    expect(player.getProgress()).toBe(0);
    expect(player.getDurationSec()).toBe(100);
  });

  it('advances progress on each 600ms tick when playing', async () => {
    const player = new SimulatedAudioPlayer();
    await player.load({ id: 't1', durationSec: 100 });
    await player.play();
    vi.advanceTimersByTime(600);
    // 0.6 / 100 = 0.006 per tick
    expect(player.getProgress()).toBeCloseTo(0.006, 5);
    vi.advanceTimersByTime(600);
    expect(player.getProgress()).toBeCloseTo(0.012, 5);
  });

  it('emits "ended" when progress crosses 1.0 and resets to 0', async () => {
    const player = new SimulatedAudioPlayer();
    await player.load({ id: 't1', durationSec: 1 }); // 0.6 progress per tick → crosses 1 on 2nd tick
    const onEnded = vi.fn();
    player.on('ended', onEnded);
    await player.play();
    vi.advanceTimersByTime(600 * 2);
    expect(onEnded).toHaveBeenCalledTimes(1);
    expect(player.getProgress()).toBe(0);
  });

  it('pause() stops ticking', async () => {
    const player = new SimulatedAudioPlayer();
    await player.load({ id: 't1', durationSec: 100 });
    await player.play();
    vi.advanceTimersByTime(600);
    const mid = player.getProgress();
    player.pause();
    vi.advanceTimersByTime(5000);
    expect(player.getProgress()).toBe(mid);
  });

  it('seek() updates progress and emits', async () => {
    const player = new SimulatedAudioPlayer();
    await player.load({ id: 't1', durationSec: 100 });
    const onProgress = vi.fn();
    player.on('progress', onProgress);
    player.seek(0.42);
    expect(player.getProgress()).toBe(0.42);
    expect(onProgress).toHaveBeenLastCalledWith(0.42);
  });
});
