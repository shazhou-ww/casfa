/**
 * CAS key utilities
 *
 * Storage keys are 26-character Crockford Base32 encoded BLAKE3s-128 hashes.
 */

/**
 * Crockford Base32 charset for validation (uppercase)
 */
const CB32_CHARS = /^[0-9A-HJKMNP-TV-Z]+$/;

/**
 * Convert hex string to Uint8Array
 */
export const hexToBytes = (hex: string): Uint8Array => {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = Number.parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
};

/**
 * Convert Uint8Array to hex string
 */
export const bytesToHex = (bytes: Uint8Array): string => {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
};

/**
 * Validate storage key format (26-char CB32 for 128-bit hash)
 */
export const isValidKey = (key: string): boolean => {
  return key.length === 26 && CB32_CHARS.test(key);
};

/**
 * Create storage path from a CB32 storage key.
 * Uses first 2 chars of the key as subdirectory for better distribution.
 *
 * Example: 000B5PHBGEC2A705WTKKMVRS30 -> cas/blake3s/00/000B5PHBGEC2A705WTKKMVRS30
 */
export const toStoragePath = (key: string, prefix = "cas/blake3s/"): string => {
  const subdir = key.slice(0, 2);
  return `${prefix}${subdir}/${key}`;
};
