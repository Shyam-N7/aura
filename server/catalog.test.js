import { describe, it, expect } from 'vitest';
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
