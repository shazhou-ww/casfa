/**
 * Client authentication cryptography types
 */

/**
 * PKCE code verifier and challenge
 */
export type PkceChallenge = {
  /** Random code verifier (43-128 URL-safe Base64 characters) */
  verifier: string;
  /** SHA-256 hash of verifier, Base64URL encoded */
  challenge: string;
  /** Challenge method (always S256) */
  method: "S256";
};

/**
 * Client secret for desktop/CLI authentication
 * 32-byte random value encoded as Crockford Base32
 */
export type ClientSecret = {
  /** Raw bytes (32 bytes) */
  bytes: Uint8Array;
  /** Crockford Base32 encoded string (52 characters) */
  encoded: string;
};

/**
 * Display code for user verification
 * Short numeric code derived from client secret
 */
export type DisplayCode = {
  /** 6-digit numeric code */
  code: string;
  /** Full display string with dashes (XXX-XXX) */
  formatted: string;
};

/**
 * Encrypted token package
 */
export type EncryptedToken = {
  /** IV (12 bytes, Base64) */
  iv: string;
  /** Encrypted data (Base64) */
  ciphertext: string;
  /** Auth tag (16 bytes, Base64) */
  tag: string;
};
