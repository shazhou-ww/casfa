/**
 * CAS Utility Functions
 *
 * - Pascal string encoding (u16 LE length + utf8 bytes)
 * - Hex/bytes conversion
 * - Crockford Base32 encoding/decoding
 */

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
export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Convert hex string to bytes
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

/**
 * Format hash as hex string (storage key)
 * This is the internal storage format, used across all storage implementations.
 */
export function hashToKey(hash: Uint8Array): string {
  return bytesToHex(hash);
}

/**
 * Extract hash bytes from hex string (storage key)
 */
export function keyToHash(key: string): Uint8Array {
  return hexToBytes(key);
}
