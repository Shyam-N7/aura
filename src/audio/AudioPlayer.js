/**
 * Interface contract for audio players.
 *
 * Implementations live next to this file:
 *   - SimulatedAudioPlayer: setInterval-based, advances progress without real audio.
 *   - HtmlAudioPlayer: wraps HTMLAudioElement, requires track.src.
 *
 * Both expose the same surface so swapping is one factory line in createAudioPlayer().
 *
 * @typedef {Object} Track
 * @property {string} id
 * @property {number} durationSec
 * @property {string} [src]                                 — present only when a real file exists
 *
 * @typedef {'progress' | 'ended' | 'play' | 'pause' | 'error' | 'volume' | 'muted' | 'eq'} AudioEvent
 *
 * @typedef {Object} AudioPlayer
 * @property {(track: Track) => Promise<void>} load          — preload + reset progress
 * @property {() => Promise<void>} play
 * @property {() => void} pause
 * @property {(progress01: number) => void} seek             — 0..1
 * @property {() => number} getProgress                      — 0..1
 * @property {() => number} getDurationSec
 * @property {(v: number) => void} setVolume                 — 0..1, persisted via localStorage in HtmlAudioPlayer
 * @property {() => number} getVolume                        — 0..1
 * @property {(b: boolean) => void} setMuted                 — persisted via localStorage in HtmlAudioPlayer
 * @property {() => boolean} isMuted
 * @property {(i: number, db: number) => void} setEqBand     — set one EQ band's gain (dB), persisted in HtmlAudioPlayer
 * @property {(gains: number[]) => void} setEqGains          — set all EQ band gains (presets)
 * @property {() => number[]} getEqGains                     — current EQ band gains (dB)
 * @property {(evt: AudioEvent, cb: Function) => () => void} on   — returns unsubscribe
 * @property {() => void} destroy
 */

// This module is types-only; the runtime exports are in ./SimulatedAudioPlayer
// and ./HtmlAudioPlayer, wired through createAudioPlayer in ./index.js.
export {};
