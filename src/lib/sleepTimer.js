// Singleton sleep-timer. start() arms it for a duration (ms) or the special
// 'end-of-set' sentinel; cancel() disarms; subscribe() notifies on state
// changes. State NOT persisted — every reload starts fresh.
//
// Why an interval over setTimeout: background tabs throttle setTimeout
// (typically to 1s minimum), so an `endsAt` timestamp + 1s polling matches
// real elapsed time even after the tab was backgrounded.

const subscribers = new Set();
let endsAt = 0;
let endOfSet = false;
let timerId = null;

function snapshot() {
  if (endOfSet) return { mode: 'end-of-set', remainingMs: null, endsAt: 0 };
  if (endsAt > 0) return { mode: 'duration', remainingMs: Math.max(0, endsAt - Date.now()), endsAt };
  return { mode: null, remainingMs: null, endsAt: 0 };
}

function notify() {
  const s = snapshot();
  for (const cb of subscribers) cb(s);
}

function stopTick() {
  if (timerId) { clearInterval(timerId); timerId = null; }
}

function startTick(onFire) {
  stopTick();
  timerId = setInterval(() => {
    if (endsAt > 0 && Date.now() >= endsAt) {
      cancel();
      onFire('duration');
    } else {
      notify();
    }
  }, 1000);
}

// Internal: fire listeners that requested the timer's expiry callback.
let fireListeners = new Set();

export function subscribeSleepFire(cb) {
  fireListeners.add(cb);
  return () => { fireListeners.delete(cb); };
}

function fireExpiry(reason) {
  for (const cb of fireListeners) cb(reason);
}

export function start(arg) {
  cancel();
  if (arg === 'end-of-set') {
    endOfSet = true;
    notify();
    return;
  }
  const ms = Number(arg);
  if (!Number.isFinite(ms) || ms <= 0) return;
  endsAt = Date.now() + ms;
  startTick(fireExpiry);
  notify();
}

export function cancel() {
  stopTick();
  endsAt = 0;
  endOfSet = false;
  notify();
}

export function getState() { return snapshot(); }
export function isEndOfSetArmed() { return endOfSet; }

// Called by App.jsx when the current queue actually reaches its end and
// can't advance — clears the flag and emits the fire so playback pauses.
export function fireEndOfSetIfArmed() {
  if (!endOfSet) return false;
  endOfSet = false;
  notify();
  fireExpiry('end-of-set');
  return true;
}

export function subscribe(cb) {
  subscribers.add(cb);
  cb(snapshot());
  return () => { subscribers.delete(cb); };
}
