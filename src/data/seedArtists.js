// Curated fallback list used when the live `getFeatured()` pool fails or
// doesn't produce 12 distinct artists. Cross-language so first-run users across
// the supported languages have something familiar to pick from (see
// data/languages.js). The long-tail languages (odia/assamese/bhojpuri/urdu)
// lean on the live trending pool rather than a hand-curated seed.
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

  // Telugu
  { name: 'Devi Sri Prasad',    language: 'telugu' },
  { name: 'S. Thaman',          language: 'telugu' },
  { name: 'Anurag Kulkarni',    language: 'telugu' },

  // Malayalam
  { name: 'Sushin Shyam',       language: 'malayalam' },
  { name: 'Jakes Bejoy',        language: 'malayalam' },

  // Kannada
  { name: 'Vasuki Vaibhav',     language: 'kannada' },
  { name: 'B. Ajaneesh Loknath', language: 'kannada' },

  // Punjabi
  { name: 'Diljit Dosanjh',     language: 'punjabi' },
  { name: 'AP Dhillon',         language: 'punjabi' },
  { name: 'Karan Aujla',        language: 'punjabi' },

  // Marathi
  { name: 'Ajay-Atul',          language: 'marathi' },
  { name: 'Avadhoot Gupte',     language: 'marathi' },

  // Bengali
  { name: 'Anupam Roy',         language: 'bengali' },
  { name: 'Nachiketa',          language: 'bengali' },

  // Gujarati
  { name: 'Kirtidan Gadhvi',    language: 'gujarati' },
  { name: 'Aditya Gadhvi',      language: 'gujarati' },
];
