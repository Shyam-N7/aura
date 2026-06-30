// Spoken-confirmation preference (the Car Mode "speak confirmations" toggle). A
// plain localStorage-backed flag: App.jsx reads getSpokenConfirm() live at speak
// time and SettingsPanel set/gets it, so no pub/sub is needed. Default ON — in
// hands-free Car Mode an audible "Now playing X" is the whole point; users who
// don't want it can turn it off.
const KEY = 'aura.spokenConfirm';

export function getSpokenConfirm() {
  try {
    const v = localStorage.getItem(KEY);
    if (v === '1') return true;
    if (v === '0') return false;
  } catch { /* ignore */ }
  return true;
}

export function setSpokenConfirm(on) {
  try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* ignore */ }
}
