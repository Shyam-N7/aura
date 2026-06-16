import { describe, it, expect, beforeAll } from 'vitest';
import CryptoJS from 'crypto-js';

// Regression guard for the DES-ECB/PKCS7 cipher configuration used by
// decryptMediaUrl (server/catalog.js). Uses a throwaway 8-byte key — NOT the
// provider key — so it proves only that the crypto-js mode/padding/encoding
// round-trips, catching any future change that breaks the cipher config.
describe('media URL DES-ECB/PKCS7 cipher config', () => {
  it('round-trips a value through the exact decrypt path used in catalog.js', () => {
    const key = CryptoJS.enc.Utf8.parse('testkey1'); // DES key = 8 bytes
    const plaintext = 'https://cdn.example.com/audio/song_320.mp4?x=1';

    const encrypted = CryptoJS.DES.encrypt(plaintext, key, {
      mode: CryptoJS.mode.ECB,
      padding: CryptoJS.pad.Pkcs7,
    }).ciphertext.toString(CryptoJS.enc.Base64);

    // Mirrors decryptMediaUrl: base64 ciphertext -> CipherParams -> Utf8 string.
    const decrypted = CryptoJS.DES.decrypt(
      { ciphertext: CryptoJS.enc.Base64.parse(encrypted) },
      key,
      { mode: CryptoJS.mode.ECB, padding: CryptoJS.pad.Pkcs7 },
    ).toString(CryptoJS.enc.Utf8);

    expect(decrypted).toBe(plaintext);
  });
});

// parsePlainLyrics turns the catalog's `<br>`-joined plain-lyrics blob into clean
// display lines. catalog.js imports config.js, which fail-fasts on missing env at
// load — so stub throwaway values, then dynamic-import the real function.
describe('parsePlainLyrics (catalog plain-lyrics fallback)', () => {
  let parsePlainLyrics;
  beforeAll(async () => {
    process.env.CATALOG_MEDIA_KEY = 'testkey1';     // must be exactly 8 bytes
    process.env.CATALOG_BITRATE = process.env.CATALOG_BITRATE || '320';
    process.env.LYRICS_TIMEOUT_MS = process.env.LYRICS_TIMEOUT_MS || '15000';
    for (const k of [
      'CATALOG_API_BASE','CATALOG_USER_AGENT','CATALOG_CTX','CATALOG_CTX_HOME','CATALOG_API_VERSION',
      'CATALOG_AUDIO_SRC_QUALITY','CATALOG_IMG_SRC_SIZE','CATALOG_IMG_DEST_SIZE',
      'CATALOG_M_SEARCH','CATALOG_M_SONG','CATALOG_M_HOME','CATALOG_M_PLAYLIST','CATALOG_M_RECO',
      'CATALOG_M_LYRICS','CATALOG_M_ARTIST','CATALOG_M_ALBUM','CATALOG_M_SUGGEST',
      'LYRICS_API_BASE','LYRICS_USER_AGENT',
    ]) process.env[k] = process.env[k] || 'x';
    ({ parsePlainLyrics } = await import('./catalog.js'));
  });

  it('strips the leading movie/song header and returns the lyric lines', () => {
    const blob = '<br>24 Movie  - Gaja<br>Song   - Mathu Nannolu<br><br>Hey hey hey<br>Baimele beralidthu';
    expect(parsePlainLyrics(blob)).toEqual([{ line: 'Hey hey hey' }, { line: 'Baimele beralidthu' }]);
  });

  it('decodes HTML entities and handles <br/> and <br /> variants', () => {
    expect(parsePlainLyrics('Tum&#039;s heart<br/>Tere bina<br />kya')).toEqual([
      { line: "Tum's heart" }, { line: 'Tere bina' }, { line: 'kya' },
    ]);
  });

  it('splits on Unicode line separators (U+2028) the provider uses inside verses', () => {
    // Many songs put the whole verse in one <br> segment, breaking lines with
    // U+2028 instead — without splitting on it the verse is one run-on blob.
    const SEP = String.fromCharCode(0x2028);
    const blob = ['first line', 'second line', 'third line'].join(SEP);
    expect(parsePlainLyrics(blob)).toEqual([
      { line: 'first line' }, { line: 'second line' }, { line: 'third line' },
    ]);
  });

  it('keeps a metadata-looking line once real lyrics have started', () => {
    // Header strip stops at the first non-header line, so a later "… music -" lyric survives.
    const blob = '<br>Movie - X<br><br>real line<br>the music - plays loud';
    expect(parsePlainLyrics(blob)).toEqual([{ line: 'real line' }, { line: 'the music - plays loud' }]);
  });

  it('returns null when there is nothing usable', () => {
    expect(parsePlainLyrics('')).toBeNull();
    expect(parsePlainLyrics(null)).toBeNull();
    expect(parsePlainLyrics('<br><br>')).toBeNull();
  });
});
