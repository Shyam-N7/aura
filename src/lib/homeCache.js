// In-memory cache for the Home screen's section fetches. Survives DesktopHome
// unmount/remount (navigating to the player and back) so sections don't
// re-fetch + cascade-reveal on every return; fresh on hard reload. Lives here
// (not module-local to DesktopHome) so other screens can invalidate a key when
// they change what Home shows — e.g. hiding a mix track must drop the cached
// mixes so the shelf can't serve it again this session.
export const homeCache = {};

export function invalidateHomeCache(...keys) {
  if (!keys.length) {
    for (const k of Object.keys(homeCache)) delete homeCache[k];
    return;
  }
  for (const k of keys) delete homeCache[k];
}
