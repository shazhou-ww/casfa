/**
 * Encoding utilities
 *
 * Common encoding/decoding functions used across the application.
 * CB32 core logic is imported from @casfa/encoding.
 */

import { decodeCB32, encodeCB32, isValidCB32 } from "@casfa/encoding";

/**
 * Encode bytes to Crockford Base32
 *
 * @param bytes - Bytes to encode
 * @returns Crockford Base32 encoded string (uppercase)
 */
export const toCrockfordBase32 = encodeCB32;

/**
 * Decode Crockford Base32 to bytes
 *
 * @param encoded - Crockford Base32 encoded string
 * @returns Decoded bytes
 * @throws Error if invalid character found
 */
export const fromCrockfordBase32 = decodeCB32;

/**
 * Check if a string is valid Crockford Base32
 *
 * @param str - String to validate
 * @returns true if valid Crockford Base32
 */
export const isValidCrockfordBase32 = isValidCB32;

/**
 * Convert a UUID string to User ID format
 *
 * Converts Cognito UUID (e.g., "340804d8-50d1-7022-08cc-c93a7198cc99")
 * to User ID format (e.g., "usr_A6JCHNMFWRT90AXMYWHJ8HKS90")
 *
 * @param uuid - UUID string (with or without hyphens)
 * @returns User ID in format "usr_{26 char Crockford Base32}"
 */
export const uuidToUserId = (uuid: string): string => {
  // Remove hyphens from UUID
  const hex = uuid.replace(/-/g, "");
  if (hex.length !== 32) {
    throw new Error(`Invalid UUID: expected 32 hex chars, got ${hex.length}`);
  }

  // Convert hex string to bytes
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }

  // Encode to Crockford Base32
  return `usr_${toCrockfordBase32(bytes)}`;
};

/**
 * Convert a User ID to UUID format
 *
 * Converts User ID format (e.g., "usr_A6JCHNMFWRT90AXMYWHJ8HKS90")
 * back to UUID format (e.g., "340804d8-50d1-7022-08cc-c93a7198cc99")
 *
 * @param userId - User ID in format "usr_{26 char Crockford Base32}"
 * @returns UUID string with hyphens
 */
export const userIdToUuid = (userId: string): string => {
  if (!userId.startsWith("usr_")) {
    throw new Error(`Invalid user ID format: expected "usr_" prefix`);
  }

  const base32 = userId.slice(4);
  const bytes = fromCrockfordBase32(base32);

  if (bytes.length !== 16) {
    throw new Error(`Invalid user ID: expected 16 bytes, got ${bytes.length}`);
  }

  // Convert bytes to hex string with hyphens
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  // Format as UUID: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

/**
 * Normalize a user identifier to User ID format
 *
 * Accepts either:
 * - UUID format: "340804d8-50d1-7022-08cc-c93a7198cc99" -> converts to usr_xxx
 * - User ID format: "usr_A6JCHNMFWRT90AXMYWHJ8HKS90" -> returns as-is
 *
 * @param input - UUID or User ID string
 * @returns User ID in format "usr_{26 char Crockford Base32}"
 */
export const normalizeUserId = (input: string): string => {
  // Already in usr_ format
  if (input.startsWith("usr_")) {
    return input;
  }

  // Looks like a UUID (with or without hyphens)
  const uuidPattern = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;
  if (uuidPattern.test(input)) {
    return uuidToUserId(input);
  }

  throw new Error(`Invalid user identifier: ${input}`);
};
