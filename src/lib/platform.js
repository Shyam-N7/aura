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

export function isAndroid() {
  if (typeof navigator === 'undefined') return false;
  return /Android/i.test(navigator.userAgent || '');
}

// Where tapping the <audio> element into Web Audio (createMediaElementSource)
// costs background playback. On iOS the tap forfeits lock-screen audio; on
// Android the tapped element's sound exits ONLY through the AudioContext, which
// the platform halts when the screen turns off (Web Audio holds no Android
// audio focus — the media notification stays up, silent). Desktop is the only
// surface where an automatic tap is safe; everything not iOS/Android degrades
// to that desktop path.
export function isTapUnsafe() { return isIOS() || isAndroid(); }
