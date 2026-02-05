/**
 * Client secret generation and handling
 *
 * Used for desktop/CLI client authentication flow
 */

import { encodeCrockfordBase32, decodeCrockfordBase32 } from "@casfa/protocol";
import type { ClientSecret, DisplayCode } from "./types.ts";

/**
 * Size of client secret in bytes
 */
const CLIENT_SECRET_SIZE = 32;

/**
 * Expected length of encoded client secret (Crockford Base32)
 * 32 bytes * 8 bits / 5 bits per char = 51.2, rounded up = 52
 */
const CLIENT_SECRET_ENCODED_LENGTH = 52;

/**
 * Generate a new random client secret
 *
 * @returns Client secret with raw bytes and encoded string
 */
export function generateClientSecret(): ClientSecret {
  const bytes = new Uint8Array(CLIENT_SECRET_SIZE);
  crypto.getRandomValues(bytes);

  return {
    bytes,
    encoded: encodeCrockfordBase32(bytes),
  };
}

/**
 * Parse an encoded client secret
 *
 * @param encoded - Crockford Base32 encoded client secret
 * @returns Client secret object
 * @throws Error if invalid format
 */
export function parseClientSecret(encoded: string): ClientSecret {
  if (encoded.length !== CLIENT_SECRET_ENCODED_LENGTH) {
    throw new Error(
      `Invalid client secret length: expected ${CLIENT_SECRET_ENCODED_LENGTH} chars, got ${encoded.length}`
    );
  }

  const bytes = decodeCrockfordBase32(encoded);
  if (bytes.length !== CLIENT_SECRET_SIZE) {
    throw new Error(
      `Invalid client secret size: expected ${CLIENT_SECRET_SIZE} bytes, got ${bytes.length}`
    );
  }

  return { bytes, encoded };
}

/**
 * Generate display code from client secret
 *
 * The display code is a 6-digit number derived from the first 3 bytes
 * of the SHA-256 hash of the client secret.
 *
 * @param secret - Client secret
 * @returns Display code with raw and formatted strings
 */
export async function generateDisplayCode(
  secret: ClientSecret
): Promise<DisplayCode> {
  // SHA-256 hash of the secret bytes
  const hashBuffer = await crypto.subtle.digest("SHA-256", secret.bytes);
  const hashArray = new Uint8Array(hashBuffer);

  // Take first 3 bytes (24 bits) to get a number 0-16777215
  const value = (hashArray[0]! << 16) | (hashArray[1]! << 8) | hashArray[2]!;

  // Reduce to 6 digits (0-999999)
  const sixDigit = value % 1000000;
  const code = sixDigit.toString().padStart(6, "0");

  return {
    code,
    formatted: `${code.slice(0, 3)}-${code.slice(3)}`,
  };
}

/**
 * Verify that a display code matches a client secret
 *
 * @param secret - Client secret
 * @param displayCode - Display code to verify (can be formatted or raw)
 * @returns true if the display code matches
 */
export async function verifyDisplayCode(
  secret: ClientSecret,
  displayCode: string
): Promise<boolean> {
  // Remove dashes if formatted
  const normalized = displayCode.replace(/-/g, "");

  const expected = await generateDisplayCode(secret);
  return expected.code === normalized;
}
