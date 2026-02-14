/**
 * Base64URL encoding/decoding (RFC 4648 Section 5)
 *
 * URL-safe Base64 variant that replaces + with -, / with _,
 * and removes trailing = padding.
 */

/**
 * Encode bytes to Base64URL string.
 *
 * @param bytes - Bytes to encode
 * @returns Base64URL encoded string (no padding)
 */
export function base64urlEncode(bytes: Uint8Array): string {
  const binary = String.fromCharCode(...bytes);
  const base64 = btoa(binary);
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Decode Base64URL string to bytes.
 *
 * @param str - Base64URL encoded string
 * @returns Decoded bytes
 */
export function base64urlDecode(str: string): Uint8Array {
  // Restore standard Base64: replace - with +, _ with /
  let base64 = str.replace(/-/g, "+").replace(/_/g, "/");

  // Re-add padding
  const pad = base64.length % 4;
  if (pad === 2) base64 += "==";
  else if (pad === 3) base64 += "=";

  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
