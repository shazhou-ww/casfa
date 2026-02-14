/**
 * CAS Utility Functions
 *
 * - Pascal string encoding (u16 LE length + utf8 bytes)
 * - Re-exports from @casfa/encoding (hex, CB32)
 */

import {
  bytesToHex as _bytesToHex,
  decodeCB32 as _decodeCB32,
  encodeCB32 as _encodeCB32,
  hexToBytes as _hexToBytes,
} from "@casfa/encoding";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/**
 * Encode a string as Pascal string (u16 LE length prefix + utf8 bytes)
 */
export function encodePascalString(str: string): Uint8Array {
  const utf8 = textEncoder.encode(str);
  if (utf8.length > 0xffff) {
    throw new Error(`String too long: ${utf8.length} bytes (max 65535)`);
  }

  const result = new Uint8Array(2 + utf8.length);
  const view = new DataView(result.buffer);
  view.setUint16(0, utf8.length, true); // LE
  result.set(utf8, 2);

  return result;
}

/**
 * Decode a Pascal string from buffer at given offset
 * @returns [decoded string, bytes consumed]
 */
export function decodePascalString(buffer: Uint8Array, offset: number): [string, number] {
  if (offset + 2 > buffer.length) {
    throw new Error("Buffer too small for Pascal string length");
  }

  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const length = view.getUint16(offset, true);

  if (offset + 2 + length > buffer.length) {
    throw new Error(`Buffer too small for Pascal string content: need ${length} bytes`);
  }

  const str = textDecoder.decode(buffer.subarray(offset + 2, offset + 2 + length));
  return [str, 2 + length];
}

/**
 * Encode multiple Pascal strings sequentially
 */
export function encodePascalStrings(strings: string[]): Uint8Array {
  const encoded = strings.map(encodePascalString);
  const totalLength = encoded.reduce((sum, s) => sum + s.length, 0);

  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const s of encoded) {
    result.set(s, offset);
    offset += s.length;
  }

  return result;
}

/**
 * Decode multiple Pascal strings from buffer
 */
export function decodePascalStrings(buffer: Uint8Array, offset: number, count: number): string[] {
  const result: string[] = [];
  let pos = offset;

  for (let i = 0; i < count; i++) {
    const [str, consumed] = decodePascalString(buffer, pos);
    result.push(str);
    pos += consumed;
  }

  return result;
}

/**
 * Convert bytes to hex string
 */
export const bytesToHex = _bytesToHex;

/**
 * Convert hex string to bytes
 */
export const hexToBytes = _hexToBytes;

/**
 * Concatenate multiple Uint8Arrays
 */
export function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((sum, a) => sum + a.length, 0);
  const result = new Uint8Array(totalLength);

  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }

  return result;
}

// ============================================================================
// Crockford Base32 — re-exported from @casfa/encoding
// ============================================================================

/** Encode bytes to Crockford Base32 string */
export const encodeCB32 = _encodeCB32;

/** Decode Crockford Base32 string to bytes */
export const decodeCB32 = _decodeCB32;

// ============================================================================
// Storage key conversion (CB32 format)
// ============================================================================

/**
 * Format hash as Crockford Base32 storage key.
 *
 * This is the canonical storage key format used across all storage
 * implementations.  For 128-bit (16-byte) hashes this produces a
 * 26-character uppercase string.
 */
export function hashToKey(hash: Uint8Array): string {
  return encodeCB32(hash);
}

/**
 * Extract hash bytes from CB32 storage key.
 */
export function keyToHash(key: string): Uint8Array {
  return decodeCB32(key);
}

// ============================================================================
// Size Flag Byte — encode node size magnitude into a single byte
// ============================================================================

/**
 * Compute the size flag byte for a given node byte length.
 *
 * The byte is split into high nibble H (bits 7–4) and low nibble L (bits 3–0).
 * It represents the **minimum upper bound** of the size:
 *
 *     sizeUpperBound = L × 16^H
 *
 * The algorithm finds the smallest (H, L) such that L × 16^H >= size,
 * with L in [0, 15] and H in [0, 15].
 *
 * Key properties:
 * - **Monotonic**: byte value order ≡ size order (enables range queries)
 * - **2-power aligned**: each H step is ×16 = ×2⁴
 * - **Max representable**: 15 × 16¹⁵ ≈ 17.3 EB
 *
 * @param size - Node serialized byte length (non-negative integer)
 * @returns Flag byte (0x00–0xFF)
 */
export function computeSizeFlagByte(size: number): number {
  if (size <= 0) return 0x00;

  // Find smallest (H, L) where L × 16^H >= size, L ∈ [1,15]
  let power = 1; // 16^H
  for (let H = 0; H <= 15; H++) {
    const L = Math.ceil(size / power);
    if (L <= 15) {
      return (H << 4) | L;
    }
    power *= 16;
  }

  // Unreachable for any practical size (> 15 × 16^15 ≈ 17.3 EB)
  return 0xff;
}

/**
 * Decode a size flag byte back to its represented upper bound.
 *
 *     sizeUpperBound = L × 16^H
 *
 * where H = high nibble, L = low nibble.
 *
 * Note: when L = 0, the upper bound is 0 regardless of H.
 *
 * @param flag - Flag byte (0x00–0xFF)
 * @returns The size upper bound this flag represents
 */
export function decodeSizeFlagByte(flag: number): number {
  const H = (flag >> 4) & 0x0f;
  const L = flag & 0x0f;
  if (L === 0) return 0;
  return L * 16 ** H;
}
