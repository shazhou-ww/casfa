/**
 * CAS key utilities
 *
 * Keys are in format "sha256:{64-char-hex}"
 */

/**
 * Extract hex hash from CAS key
 */
export const extractHash = (casKey: string): string => {
  return casKey.startsWith("sha256:") ? casKey.slice(7) : casKey;
};

/**
 * Create CAS key from hex hash
 */
export const toKey = (hexHash: string): string => {
  return `sha256:${hexHash}`;
};

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
 * Validate CAS key format
 */
export const isValidKey = (key: string): boolean => {
  if (!key.startsWith("sha256:")) return false;
  const hash = key.slice(7);
  return hash.length === 64 && /^[a-f0-9]+$/.test(hash);
};

/**
 * Create storage path from CAS key
 * Uses first 2 chars of hash as subdirectory for better distribution
 *
 * Example: sha256:abcdef... -> cas/sha256/ab/abcdef...
 */
export const toStoragePath = (casKey: string, prefix = "cas/sha256/"): string => {
  const hash = extractHash(casKey);
  const subdir = hash.slice(0, 2);
  return `${prefix}${subdir}/${hash}`;
};
