/**
 * Encoding utilities
 *
 * Common encoding/decoding functions used across the application.
 */

// Crockford Base32 alphabet (excludes I, L, O, U to avoid ambiguity)
const CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

// Reverse lookup table for decoding
const CROCKFORD_DECODE: Record<string, number> = {};
for (let i = 0; i < CROCKFORD_ALPHABET.length; i++) {
  CROCKFORD_DECODE[CROCKFORD_ALPHABET[i]!] = i;
}
// Also accept lowercase
for (let i = 0; i < CROCKFORD_ALPHABET.length; i++) {
  CROCKFORD_DECODE[CROCKFORD_ALPHABET[i]!.toLowerCase()] = i;
}

/**
 * Encode bytes to Crockford Base32
 *
 * Crockford Base32 uses a 32-character alphabet that excludes
 * I, L, O, U to avoid visual ambiguity.
 *
 * @param bytes - Bytes to encode
 * @returns Crockford Base32 encoded string (uppercase)
 */
export const toCrockfordBase32 = (bytes: Uint8Array): string => {
  let bits = 0;
  let value = 0;
  let result = "";

  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;

    while (bits >= 5) {
      bits -= 5;
      result += CROCKFORD_ALPHABET[(value >> bits) & 0x1f];
    }
  }

  // Handle remaining bits
  if (bits > 0) {
    result += CROCKFORD_ALPHABET[(value << (5 - bits)) & 0x1f];
  }

  return result;
};

/**
 * Decode Crockford Base32 to bytes
 *
 * @param encoded - Crockford Base32 encoded string
 * @returns Decoded bytes
 * @throws Error if invalid character found
 */
export const fromCrockfordBase32 = (encoded: string): Uint8Array => {
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (const char of encoded) {
    const decoded = CROCKFORD_DECODE[char];
    if (decoded === undefined) {
      throw new Error(`Invalid Crockford Base32 character: ${char}`);
    }

    value = (value << 5) | decoded;
    bits += 5;

    if (bits >= 8) {
      bits -= 8;
      bytes.push((value >> bits) & 0xff);
    }
  }

  return new Uint8Array(bytes);
};

/**
 * Check if a string is valid Crockford Base32
 *
 * @param str - String to validate
 * @returns true if valid Crockford Base32
 */
export const isValidCrockfordBase32 = (str: string): boolean => {
  // Crockford Base32 excludes I, L, O, U (case-insensitive)
  if (str.length === 0) return true;
  return /^[0-9A-HJ-KM-NP-TV-Za-hj-km-np-tv-z]+$/.test(str);
};

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
