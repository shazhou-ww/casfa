/**
 * Crockford Base32 encoding/decoding
 *
 * Implements Crockford's Base32 encoding which uses a 32-character alphabet
 * excluding I, L, O, U to avoid visual ambiguity.
 *
 * @see https://www.crockford.com/base32.html
 */

const CB32_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

const CB32_DECODE: Record<string, number> = {};
for (let i = 0; i < CB32_ALPHABET.length; i++) {
  CB32_DECODE[CB32_ALPHABET[i]!] = i;
  CB32_DECODE[CB32_ALPHABET[i]!.toLowerCase()] = i;
}
// Handle confusable characters: I/i/L/l -> 1, O/o -> 0
CB32_DECODE.I = 1;
CB32_DECODE.i = 1;
CB32_DECODE.L = 1;
CB32_DECODE.l = 1;
CB32_DECODE.O = 0;
CB32_DECODE.o = 0;

/**
 * Encode bytes to Crockford Base32 string.
 *
 * @param bytes - Bytes to encode
 * @returns Uppercase Crockford Base32 string
 */
export function encodeCB32(bytes: Uint8Array): string {
  let result = "";
  let buffer = 0;
  let bitsLeft = 0;

  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bitsLeft += 8;

    while (bitsLeft >= 5) {
      bitsLeft -= 5;
      result += CB32_ALPHABET[(buffer >> bitsLeft) & 0x1f];
    }
  }

  // Handle remaining bits (pad with zeros)
  if (bitsLeft > 0) {
    result += CB32_ALPHABET[(buffer << (5 - bitsLeft)) & 0x1f];
  }

  return result;
}

/**
 * Decode Crockford Base32 string to bytes.
 *
 * Handles lowercase input and confusable characters (I→1, L→1, O→0).
 *
 * @param str - Crockford Base32 encoded string
 * @returns Decoded bytes
 * @throws Error if invalid character found
 */
export function decodeCB32(str: string): Uint8Array {
  let buffer = 0;
  let bitsLeft = 0;
  const result: number[] = [];

  for (const char of str) {
    const value = CB32_DECODE[char];
    if (value === undefined) {
      throw new Error(`Invalid Crockford Base32 character: ${char}`);
    }

    buffer = (buffer << 5) | value;
    bitsLeft += 5;

    if (bitsLeft >= 8) {
      bitsLeft -= 8;
      result.push((buffer >> bitsLeft) & 0xff);
    }
  }

  return new Uint8Array(result);
}

/**
 * Check if a string is valid Crockford Base32.
 *
 * @param str - String to validate
 * @returns true if all characters are valid CB32 (case-insensitive)
 */
export function isValidCB32(str: string): boolean {
  if (str.length === 0) return true;
  return /^[0-9A-HJ-KM-NP-TV-Za-hj-km-np-tv-z]+$/.test(str);
}
