import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { LINK_ERRORS, IMPORT_ERRORS, COPY, copyForCode, isRetryable } from './ytImportCopy.js';

describe('every code the server can emit has copy', () => {
  // The point of this test: a new error code added to the server is a silent
  // "something went wrong" on both clients until someone writes words for it.
  // Reading the server source is the only way to catch that automatically —
  // any other approach requires remembering, which is the thing that fails.
  const serverDir = join(import.meta.dirname, '../../server');
  const codes = new Set();
  for (const f of readdirSync(serverDir).filter(n => n.endsWith('.js') && !n.endsWith('.test.js'))) {
    const src = readFileSync(join(serverDir, f), 'utf8');
    for (const m of src.matchAll(/'(YT_[A-Z_]+)'/g)) codes.add(m[1]);
  }

  // Config knobs share the prefix but are not error codes.
  const NOT_ERRORS = new Set(['YT_IMPORT_DAILY_CAP', 'YT_IMPORT_USER_DAILY']);

  it('found the codes to check', () => {
    expect(codes.size).toBeGreaterThan(20);
  });

  it('has an entry for each one', () => {
    const missing = [...codes]
      .filter(c => !NOT_ERRORS.has(c))
      .filter(c => !LINK_ERRORS[c] && !IMPORT_ERRORS[c]);
    expect(missing).toEqual([]);
  });

  it('has no entries for codes the server never sends', () => {
    // Dead copy is a smaller problem than missing copy, but it still misleads
    // whoever reads this file to learn what the feature can do.
    const known = [...Object.keys(LINK_ERRORS), ...Object.keys(IMPORT_ERRORS)];
    expect(known.filter(c => !codes.has(c))).toEqual([]);
  });
});

describe('copy quality rules', () => {
  const all = { ...LINK_ERRORS, ...IMPORT_ERRORS };

  it('every title is sentence case and calm', () => {
    for (const [code, entry] of Object.entries(all)) {
      expect(entry.title, code).toBeTruthy();
      expect(entry.title, code).not.toMatch(/!/);
      // Bans a title that IS the word — "Error", "Oops", "Error!" — not the
      // word in a real sentence. "YouTube returned an error" is fine copy;
      // "Error" as a heading tells the reader nothing.
      expect(entry.title.toLowerCase().trim(), code).not.toMatch(/^(oops|error|whoops|uh oh)\b/);
      // Not SHOUTING, and not a bare code leaking through.
      expect(entry.title, code).not.toMatch(/^YT_/);
    }
  });

  it('leaks no jargon the user did not introduce', () => {
    // The user pasted a link. They did not ask about any of these.
    const jargon = /\b(oauth|quota|api|endpoint|token|playlist id|prefix|null|undefined|json)\b/i;
    for (const [code, entry] of Object.entries(all)) {
      expect(`${entry.title} ${entry.body ?? ''}`, code).not.toMatch(jargon);
    }
  });

  it('marks retryability explicitly on every import error', () => {
    for (const [code, entry] of Object.entries(IMPORT_ERRORS)) {
      expect(typeof entry.retryable, code).toBe('boolean');
    }
  });

  it('does not offer a retry for the things retrying cannot fix', () => {
    for (const code of ['YT_QUOTA', 'YT_TOO_LARGE', 'YT_USER_CAP', 'YT_NOT_FOUND']) {
      expect(isRetryable(code), code).toBe(false);
    }
    for (const code of ['YT_TIMEOUT', 'YT_UNREACHABLE', 'YT_PRIVATE']) {
      expect(isRetryable(code), code).toBe(true);
    }
  });
});

describe('copyForCode', () => {
  it('returns the written entry for a known code', () => {
    expect(copyForCode('YT_WATCH_LATER').title).toMatch(/Watch Later/);
  });

  it('falls back to the server message for a code this build has not seen', () => {
    // A client shipped before a server change still says something specific.
    expect(copyForCode('YT_FROM_THE_FUTURE', 'that playlist is haunted'))
      .toMatchObject({ title: 'that playlist is haunted', retryable: true });
  });

  it('still says something when the server sends nothing useful', () => {
    expect(copyForCode(null, '').title).toBe('Something went wrong');
  });
});

describe('the honest framings', () => {
  it('calls a mix import a snapshot, not a sync', () => {
    const s = COPY.confirm.mix(30);
    expect(s).toMatch(/first 30/);
    expect(s).toMatch(/snapshot/);
    expect(s).toMatch(/not a live sync/);
  });

  it('tells the user leaving the progress screen is safe', () => {
    expect(COPY.progress.safeToLeave).toMatch(/leave/i);
  });

  it('does not apologise for review — it is a third of a normal import', () => {
    expect(COPY.done.review(11)).not.toMatch(/sorry|unfortunately|failed|couldn.t/i);
  });

  it('makes clear a missing song is not the user’s fault', () => {
    expect(COPY.review.noneHint).toMatch(/isn.t something you did/);
  });

  it('says the playlist already plays before asking for review work', () => {
    expect(COPY.done.reassurance).toMatch(/ready to play now/);
    expect(COPY.done.reassurance).toMatch(/optional/);
  });

  it('pluralises the counts it renders', () => {
    expect(COPY.done.ready(1)).toBe('1 song added');
    expect(COPY.done.ready(4)).toBe('4 songs added');
    expect(COPY.refresh.added(1)).toMatch(/1 new song/);
    expect(COPY.refresh.added(3)).toMatch(/3 new songs/);
  });

  it('warns that stopping keeps what already arrived', () => {
    expect(COPY.cancel.body).toMatch(/will stay/);
  });
});
