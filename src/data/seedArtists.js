// Curated fallback list used when the live `getFeatured()` pool fails or
// doesn't produce 12 distinct artists. Cross-language so first-run users
// across all 5 supported languages have something familiar to pick from.
export const SEED_ARTIST_FALLBACK = [
  // Tamil
  { name: 'A.R. Rahman',        language: 'tamil' },
  { name: 'Anirudh Ravichander',language: 'tamil' },
  { name: 'Ilaiyaraaja',        language: 'tamil' },
  { name: 'Sid Sriram',         language: 'tamil' },

  // English
  { name: 'Taylor Swift',       language: 'english' },
  { name: 'The Weeknd',         language: 'english' },
  { name: 'Coldplay',           language: 'english' },
  { name: 'Arctic Monkeys',     language: 'english' },

  // Hindi
  { name: 'Arijit Singh',       language: 'hindi' },
  { name: 'Pritam',             language: 'hindi' },
  { name: 'Shreya Ghoshal',     language: 'hindi' },

  // Malayalam
  { name: 'Sushin Shyam',       language: 'malayalam' },
  { name: 'Jakes Bejoy',        language: 'malayalam' },

  // Kannada
  { name: 'Vasuki Vaibhav',     language: 'kannada' },
  { name: 'B. Ajaneesh Loknath', language: 'kannada' },
];
