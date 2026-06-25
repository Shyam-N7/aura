// Canonical language list — the single source of truth for every surface that
// offers a language choice (onboarding seeds, search filter, library hubs, mood
// bridge constraints). Previously this set was copy-pasted (and stuck at 5) in
// each of those files; keep it here so adding a language is a one-line change.
//
// PRIMARY are shown up front; MORE sit behind a "more languages" expander in
// onboarding so the first row stays calm. All are real catalog languages.
export const PRIMARY_LANGUAGES = ['tamil', 'english', 'hindi', 'malayalam', 'kannada', 'telugu'];
export const MORE_LANGUAGES    = ['bengali', 'marathi', 'punjabi', 'gujarati', 'urdu', 'bhojpuri', 'odia', 'assamese'];
export const LANGUAGES = [...PRIMARY_LANGUAGES, ...MORE_LANGUAGES];
