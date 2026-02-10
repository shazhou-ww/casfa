/**
 * Token Request utilities
 *
 * Functions for client authorization request flow.
 * Based on docs/delegate-token-refactor/06-client-auth-flow.md
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { fromCrockfordBase32, toCrockfordBase32 } from "./encoding.ts";

// ============================================================================
// Display Code Generation
// ============================================================================

/**
 * Generate a human-readable display code for verification
 *
 * Format: XXXX-YYYY (8 Crockford Base32 characters with hyphen)
 */
export function generateDisplayCode(): string {
  const bytes = randomBytes(5); // 40 bits -> 8 base32 chars
  const encoded = toCrockfordBase32(bytes);
  return `${encoded.slice(0, 4)}-${encoded.slice(4, 8)}`;
}

// ============================================================================
// Client Secret Generation
// ============================================================================

/**
 * Generate a client secret
 *
 * 128-bit random value encoded as 26-character Crockford Base32
 */
export function generateClientSecret(): string {
  const bytes = randomBytes(16); // 128 bits
  return toCrockfordBase32(bytes);
}

/**
 * Validate client secret format
 *
 * Must be 26 characters of Crockford Base32
 */
export function isValidClientSecret(secret: string): boolean {
  if (secret.length !== 26) return false;
  return /^[0-9A-HJ-KM-NP-TV-Z]+$/i.test(secret);
}

// ============================================================================
// Token Encryption (AES-256-GCM)
// ============================================================================

const ENCRYPTION_SALT = "casfa-token-encryption-v1";

/**
 * Derive encryption key from client secret
 */
function deriveKey(clientSecret: string): Buffer {
  const secretBytes = fromCrockfordBase32(clientSecret);
  return createHash("sha256").update(secretBytes).update(ENCRYPTION_SALT).digest();
}

/**
 * Encrypt a token using client secret
 *
 * Uses AES-256-GCM with random IV
 * Output format: base64(IV + ciphertext + authTag)
 *
 * @param tokenBytes - Token to encrypt
 * @param clientSecret - 26-character Crockford Base32 client secret
 * @returns Base64-encoded encrypted token
 */
export function encryptToken(tokenBytes: Uint8Array, clientSecret: string): string {
  const key = deriveKey(clientSecret);
  const iv = randomBytes(12);

  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(tokenBytes), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Combine: IV (12) + ciphertext + authTag (16)
  return Buffer.concat([iv, encrypted, authTag]).toString("base64");
}

/**
 * Decrypt a token using client secret
 *
 * @param encryptedBase64 - Base64-encoded encrypted token
 * @param clientSecret - 26-character Crockford Base32 client secret
 * @returns Decrypted token bytes
 * @throws Error if decryption fails
 */
export function decryptToken(encryptedBase64: string, clientSecret: string): Uint8Array {
  const data = Buffer.from(encryptedBase64, "base64");

  if (data.length < 12 + 16) {
    throw new Error("Encrypted data too short");
  }

  const key = deriveKey(clientSecret);
  const iv = data.subarray(0, 12);
  const authTag = data.subarray(-16);
  const ciphertext = data.subarray(12, -16);

  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/**
 * Hash client secret for storage
 *
 * Uses Blake3-256 for consistent hashing
 */
export function hashClientSecret(clientSecret: string): string {
  const secretBytes = fromCrockfordBase32(clientSecret);
  const hash = createHash("sha256").update(secretBytes).update("casfa-client-secret-hash").digest();
  return hash.toString("hex");
}
