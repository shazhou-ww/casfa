/**
 * Hex encoding/decoding utilities
 */

/**
 * Convert bytes to hex string.
 *
 * @param bytes - Bytes to encode
 * @returns Lowercase hex string
 */
export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Convert hex string to bytes.
 *
 * @param hex - Hex string (must have even length)
 * @returns Decoded bytes
 * @throws Error if hex string has odd length
 */
export function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) {
    throw new Error("Hex string must have even length");
  }

  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }

  return bytes;
}
