/**
 * @casfa/client-auth-crypto
 *
 * Client authentication cryptography for CASFA.
 * Implements PKCE, client secret handling, display codes, and token encryption.
 *
 * @packageDocumentation
 */

// ============================================================================
// Types
// ============================================================================

export type {
  ClientSecret,
  DisplayCode,
  EncryptedToken,
  PkceChallenge,
} from "./types.ts";

// ============================================================================
// PKCE
// ============================================================================

export {
  generateCodeChallenge,
  generateCodeVerifier,
  generatePkceChallenge,
  verifyPkceChallenge,
} from "./pkce.ts";

// ============================================================================
// Client Secret
// ============================================================================

export {
  generateClientSecret,
  generateDisplayCode,
  parseClientSecret,
  verifyDisplayCode,
} from "./client-secret.ts";

// ============================================================================
// Encryption
// ============================================================================

export {
  decryptAesGcm,
  decryptToken,
  deriveKey,
  encryptAesGcm,
  encryptToken,
  formatEncryptedToken,
  parseEncryptedToken,
} from "./encryption.ts";
