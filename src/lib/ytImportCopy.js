// Every word the YouTube import can say, in one place.
//
// This is the copy pack as a MODULE rather than a document, for one reason: a
// document drifts. A string that has to be imported to render cannot quietly
// disagree with what the user sees, and an error code with no entry here is a
// missing-key crash in development rather than a shrug in production.
//
// The CODE is the contract, never the message. The server sends
// {error, code} and the client switches on `code`, so wording can change here —
// or in a native release — without a server deploy, and every case gets text
// written for it instead of a generic apology. `error` from the server is the
// fallback for a code a client build has not seen yet.
//
// House style, applied throughout below:
//  - Say what happened, then what to do. Never only the first.
//  - Blame the situation, not the user. "YouTube doesn't allow this" beats
//    "you pasted the wrong thing".
//  - No jargon the user did not introduce. They pasted a link; they did not
//    ask about playlist id prefixes, quotas or OAuth.
//  - Sentence case, no exclamation marks, no "Oops".

// ── Link errors: settled before anything is spent ───────────────────
//
// These all come back from /preview or the create call, and every one of them
// is decided from the link alone. Several would otherwise SUCCEED at importing
// nothing, which is why they are worth this much text.
export const LINK_ERRORS = {
  YT_EMPTY: {
    title: 'Paste a link to start',
    body: 'Copy a YouTube playlist or mix link and paste it here.',
  },
  YT_NOT_A_URL: {
    title: "That doesn't look like a link",
    body: 'Paste the whole address, starting with youtube.com.',
  },
  YT_NOT_YOUTUBE: {
    title: 'That link is not from YouTube',
    body: 'Only YouTube playlists and mixes can be imported right now.',
  },
  YT_VIDEO_ONLY: {
    // The single most common mistake. The user pasted something real — say so,
    // rather than implying the link was junk.
    title: "That's a single video",
    body: 'Open the playlist or mix it belongs to, then copy that link instead.',
  },
  YT_NO_PLAYLIST: {
    title: "That link doesn't have a playlist in it",
    body: 'Open the playlist on YouTube and copy the link from there.',
  },
  YT_MALFORMED_ID: {
    title: "That link is missing something",
    body: 'Try copying it again from YouTube.',
  },
  YT_WATCH_LATER: {
    // Worth being precise: users assume we are the ones refusing.
    title: 'Watch Later cannot be read by any app',
    body: "YouTube keeps it private — not even YouTube's own apps can share it. Save the videos to a normal playlist and import that.",
  },
  YT_HISTORY: {
    title: 'Watch history stays private to YouTube',
    body: 'Make a playlist from the songs you want, then import that.',
  },
  YT_OAUTH_REQUIRED: {
    title: 'That playlist is tied to your YouTube account',
    body: 'In YouTube, set it to unlisted or public, then paste the link again.',
  },
  YT_NEEDS_SAVE: {
    // A user-seeded mix (RDMM/RDAMVM). Whether a server key can read these is
    // genuinely untested, so the copy gives the step that always works rather
    // than a claim we cannot stand behind.
    title: 'That mix was built for your account',
    body: 'Open it in YouTube, tap Save, then paste the link to the saved playlist.',
  },
  YT_UNKNOWN_KIND: {
    title: "We don't recognise that kind of playlist",
    body: 'Ordinary playlists, albums and mixes all work.',
  },
  YT_UNSUPPORTED: {
    title: "That one can't be imported",
    body: 'Try an ordinary playlist, album or mix link.',
  },
};

// ── Failures during the import ──────────────────────────────────────
export const IMPORT_ERRORS = {
  YT_NOT_FOUND: {
    title: "We couldn't find that playlist",
    body: 'It may have been deleted, or made private since the link was shared.',
    retryable: false,
  },
  YT_PRIVATE: {
    title: 'That playlist is private',
    body: 'In YouTube, set it to unlisted or public, then try again.',
    retryable: true,
  },
  YT_QUOTA: {
    // Ours to fix, not theirs. Do not make this sound like their fault.
    title: 'Imports are paused until tomorrow',
    body: "We've reached YouTube's daily limit. Nothing is lost — try again tomorrow.",
    retryable: false,
  },
  YT_TOO_LARGE: {
    title: 'That playlist is very large',
    body: 'Import one with fewer than 1,000 songs for now.',
    retryable: false,
  },
  YT_TIMEOUT: {
    title: 'YouTube took too long to answer',
    body: 'Try again in a moment.',
    retryable: true,
  },
  YT_UNREACHABLE: {
    title: "We couldn't reach YouTube",
    body: 'Check your connection and try again.',
    retryable: true,
  },
  YT_UPSTREAM: {
    title: 'YouTube returned an error',
    body: 'Try again in a few minutes.',
    retryable: true,
  },
  YT_USER_CAP: {
    title: "That's a lot of importing for one day",
    body: 'You can import more tomorrow.',
    retryable: false,
  },
  YT_GLOBAL_CAP: {
    title: 'Imports are busy right now',
    body: 'Try again in a little while.',
    retryable: true,
  },
  YT_DISABLED: {
    title: 'Importing is not available right now',
    body: 'It will be back shortly.',
    retryable: false,
  },
  YT_INTERNAL: {
    title: 'Something went wrong on our side',
    body: 'Nothing was lost — try again.',
    retryable: true,
  },
  YT_NOT_OFFERED: {
    title: 'That suggestion is no longer available',
    body: 'Pick another, or skip this one.',
    retryable: false,
  },
  YT_NOT_RUNNING: {
    title: 'That import has already finished',
    body: null,
    retryable: false,
  },
  YT_BAD_ID: {
    title: "We couldn't find that import",
    body: null,
    retryable: false,
  },
  YT_NO_LINK: {
    // Reached when a refresh is attempted on a playlist with no stored source —
    // most often one built from a mix, which regenerates every time YouTube
    // makes it and so has nothing stable to refresh against.
    title: "There's nothing to refresh",
    body: 'This playlist wasn’t imported from a YouTube playlist we can check again.',
    retryable: false,
  },
};

// ── The steady states ───────────────────────────────────────────────
export const COPY = {
  entry: {
    label: 'Import from YouTube',
    hint: 'Paste a playlist or mix link and we’ll rebuild it here.',
  },

  paste: {
    placeholder: 'Paste a YouTube playlist or mix link',
    action: 'Import',
    checking: 'Checking that link…',
  },

  // Shown after /preview, before the user commits. This is where the honest
  // framing has to land, because afterwards it reads as an excuse.
  confirm: {
    playlist: (n) => (n ? `${n} songs. We’ll find each one in AURA.` : 'We’ll find each song in AURA.'),
    // A radio mix is not a fixed list. The same link returns different songs on
    // a later fetch — measured, twice — so "snapshot" is the literal truth and
    // the UI must not imply a sync it cannot deliver.
    mix: (n) => `Mixes don’t have an end, so we’ll take the first ${n} songs. This is a snapshot, not a live sync — the mix will change on YouTube, and your playlist won’t.`,
    action: 'Import',
    cancel: 'Cancel',
  },

  progress: {
    // The queued moment. There are no items yet — fetchPhase writes them all in
    // one transaction at the END of the fetch — so for this stretch the stage
    // line is genuinely the only thing there is to show.
    starting: 'Starting…',
    fetching: 'Reading the playlist…',
    // Progress must be countable. "Matching 12 of 30" is the only honest
    // progress indicator here, since per-song time varies by an order of
    // magnitude between a cache hit and a cold search.
    matching: (done, total) => `Finding songs — ${done} of ${total}`,
    // Same count, different words, for the last few. Earned rather than
    // decorative: it is driven by the real remaining count, so a drain that
    // stalls at 28 of 30 sits on this line instead of easing toward a finish
    // that is not happening.
    almostThere: (done, total) => `Almost there — ${done} of ${total}`,
    building: 'Building your playlist…',
    // Leaving is safe: the drain resumes on the next poll, and the cron picks
    // up whatever a closed app left behind. Say so, or users will sit and wait.
    safeToLeave: 'You can leave this screen — we’ll keep going.',
    // Per-song status in the live list. The drain resolves items strictly in
    // position order (matchPhase: ORDER BY position ASC LIMIT 1), so "the one
    // being worked on" is the first item with no tier yet — a fact about the
    // server's cursor, not a guess dressed up as one. That is what makes it
    // honest to name the song on screen.
    row: {
      working: 'Matching…',
      matched: 'Added',
      review: 'Needs a check',
      missing: 'Not in our catalogue',
    },
    // ── Keys mirrored from the native pack (unused here today) ──
    //
    // Native's progress screen grew a rotating under-line, an elapsed counter
    // and a match-reveal card. The keys land here too so the twin files stay
    // diffable and the web can adopt any of it without a second negotiation.
    //
    // The rotating words are advanced by the POLL, never by a clock — the poll
    // is the server's worker, so an advance is evidence of a completed work
    // slice. Every string in a pool must be true of the WHOLE phase, which is
    // what makes which-one-is-showing carry no information: the countable
    // claim stays on the stage line above, driven by real counts.
    words: {
      queued: ['Lining this up', 'About to start reading'],
      fetching: [
        'Asking YouTube for the list',
        'Reading the tracklist',
        'YouTube sends these a page at a time',
        'Writing them all down at once',
      ],
      matching: [
        'Looking this one up',
        'Searching our catalogue',
        'Reading the title',
        'Comparing what came back',
        'Checking the length',
      ],
      closing: [
        'Nearly through the list',
        'Finishing the last few',
        'Putting the playlist together',
      ],
    },
    elapsedLabel: 'Time so far',
    // The match reveal card: what the last song BECAME — the winning catalog
    // track over the messy YouTube title it arrived as.
    found: 'Found',
    was: (t) => `Was: ${t}`,
  },

  // The result summary. Ordered auto / review / missing, because that is
  // descending order of "already done for you".
  done: {
    ready: (auto) => `${auto} ${auto === 1 ? 'song' : 'songs'} added`,
    // ~35% of an import lands here. It is a normal part of the flow, so the
    // copy is an invitation, never an apology.
    review: (n) => `${n} to check — we found more than one possible match`,
    missing: (n) => `${n} not in our catalogue`,
    allAuto: 'Every song matched. Your playlist is ready.',
    nothingMatched: 'We couldn’t find any of these songs in our catalogue. Nothing was added.',
    open: 'Open playlist',
    reviewAction: 'Check the rest',
    later: 'Later',
    // The playlist already exists and already plays. This is the whole reason
    // for creating it before review rather than after.
    reassurance: 'Your playlist is ready to play now — checking the rest is optional.',
  },

  review: {
    title: 'Which one is it?',
    progress: (done, total) => `${done} of ${total}`,
    // Naming what we read is what makes the choice explicable rather than
    // arbitrary: "A - B" is song-artist in Indian titles and artist-song in
    // Western ones, and the winning reading is shown for exactly that reason.
    readAs: (title, artist) => (artist ? `We read this as “${title}” by ${artist}` : `We read this as “${title}”`),
    onYouTube: 'On YouTube',
    pick: 'That’s the one',
    skip: 'Skip',
    skipAll: 'Skip the rest',
    // Zero candidates. Not a failure the user can fix, and it must not look
    // like one: the catalogue genuinely cannot answer some queries, notably in
    // non-Latin scripts.
    none: 'We couldn’t find this one in our catalogue.',
    noneHint: 'Nothing to choose from here — it isn’t something you did.',
    done: 'All checked',
    doneBody: 'Your playlist is complete.',
  },

  // Re-import of a playlist already linked.
  refresh: {
    action: 'Check for new songs',
    checking: 'Checking YouTube…',
    unchanged: 'Nothing new — your playlist is up to date.',
    added: (n) => `${n} new ${n === 1 ? 'song' : 'songs'} added.`,
    // Refresh is deliberately not offered for mixes; if one is somehow reached,
    // this is the honest reason.
    notForMixes: 'Mixes change every time YouTube generates them, so there’s nothing stable to refresh against.',
  },

  cancel: {
    action: 'Stop importing',
    confirm: 'Stop this import?',
    // Cancelling does not delete what already arrived, and the user should know
    // that before they decide.
    body: 'Songs already added will stay in your playlist.',
    keep: 'Keep importing',
    stop: 'Stop',
  },
};

/**
 * The message for a server error code, with a sane fallback.
 *
 * `serverMessage` is what the API sent. It is used only when the code is one
 * this build has never heard of — a client shipped before a server change still
 * says something specific rather than "something went wrong".
 */
export function copyForCode(code, serverMessage) {
  const hit = LINK_ERRORS[code] ?? IMPORT_ERRORS[code];
  if (hit) return hit;
  return {
    title: serverMessage || 'Something went wrong',
    body: null,
    retryable: true,
  };
}

/** Is this code worth offering a retry button for? */
export function isRetryable(code) {
  return IMPORT_ERRORS[code]?.retryable === true;
}
