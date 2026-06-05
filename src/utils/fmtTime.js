export function fmtTime(s) {
  s = Math.max(0, Math.floor(s));
  return `${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;
}
