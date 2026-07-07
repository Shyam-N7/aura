// The in-app changelog. Newest first; ids are monotonically increasing ints —
// the shipped bundle IS the version (no build plumbing needed): a service-worker
// update delivers a bundle with new entries, and lib/whatsNew compares the top
// id against what this user has already seen. Only user-VISIBLE changes belong
// here, in the plain lowercase house voice; infra work never gets an entry.
export const RELEASES = [
  {
    id: 2,
    date: '2026-07-08',
    title: 'easier to find your way around',
    items: [
      { title: 'long-press any song', body: 'hold a song on your phone for play next, add to queue and more — the same menu right-click opens on desktop.' },
      { title: 'play a mix in one tap', body: 'mixes on home now have a play button, no need to open them first.' },
      { title: 'help, when you want it', body: 'settings → help has what’s new, the tour, and keyboard shortcuts.' },
    ],
  },
  {
    id: 1,
    date: '2026-07-06',
    title: 'made for you mixes',
    items: [
      { title: 'mixes built from your plays', body: 'on repeat, new to you, bring it back — fresh dated editions from your listening. skips count.' },
      { title: 'hide anything', body: '“don’t show this again” on any mix track. undo anytime in settings.' },
    ],
  },
];

export const LATEST_ID = RELEASES[0].id;
