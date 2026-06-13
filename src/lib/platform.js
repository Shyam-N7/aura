// Platform detection. iOS/iPadOS Safari forfeits native lock-screen / background
// audio playback the moment an <audio> element is tapped by Web Audio
// (createMediaElementSource) — so the player avoids that tap on iOS. Covers
// iPhone/iPod/iPad plus iPadOS 13+, which reports as desktop Safari
// ("MacIntel" + a touch screen).
export function isIOS() {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  return /iP(hone|ad|od)/.test(ua)
    || (navigator.platform === 'MacIntel' && (navigator.maxTouchPoints || 0) > 1);
}
