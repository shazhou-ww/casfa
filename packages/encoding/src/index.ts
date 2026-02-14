/**
 * @casfa/encoding
 *
 * Shared encoding utilities for the CASFA ecosystem.
 *
 * - Crockford Base32 (CB32) encode/decode
 * - Base64URL encode/decode
 * - Hex encode/decode
 * - Human-readable formatting (formatSize)
 *
 * This package has zero runtime dependencies and is designed to be
 * imported by both `@casfa/core` and `@casfa/protocol` (breaking
 * any circular dependency between them).
 */

export { base64urlDecode, base64urlEncode } from "./base64url.ts";
export { decodeCB32, encodeCB32, isValidCB32 } from "./crockford-base32.ts";
export { formatSize } from "./format.ts";
export { bytesToHex, hexToBytes } from "./hex.ts";
