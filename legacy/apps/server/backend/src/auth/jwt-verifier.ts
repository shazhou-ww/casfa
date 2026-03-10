/**
 * JWT Verifier Factories
 *
 * Thin wrappers around `@casfa/oauth-consumer` that add Cognito-specific
 * subject extraction (UUID → `usr_` format).
 *
 * - {@link createCognitoJwtVerifier} — production JWKS-based (Cognito)
 * - {@link createMockJwtVerifier} — HMAC-based for dev/test
 * - {@link createMockJwt} — generate mock JWTs for testing
 */

import {
  createJwtVerifier,
  createMockJwt as createMockJwtBase,
  createMockJwtVerifier as createMockJwtVerifierBase,
  type JwtVerifier,
} from "@casfa/oauth-consumer";
import type { CognitoConfig } from "../config.ts";
import { uuidToUserId } from "../util/encoding.ts";

export type { JwtVerifier } from "@casfa/oauth-consumer";

// ============================================================================
// Cognito JWT Verifier
// ============================================================================

/**
 * Create a Cognito JWT verifier.
 *
 * Wraps `@casfa/oauth-consumer`'s `createJwtVerifier` with Cognito-specific
 * JWKS URL construction and UUID → `usr_` subject extraction.
 */
export const createCognitoJwtVerifier = (config: CognitoConfig): JwtVerifier => {
  const jwksUri = `https://cognito-idp.${config.region}.amazonaws.com/${config.userPoolId}/.well-known/jwks.json`;
  const issuer = `https://cognito-idp.${config.region}.amazonaws.com/${config.userPoolId}`;

  return createJwtVerifier({
    jwksUri,
    issuer,
    extractSubject: (claims) => uuidToUserId(claims.sub as string),
  });
};

// ============================================================================
// Mock JWT Verifier
// ============================================================================

/**
 * Create a mock JWT verifier for testing.
 *
 * Wraps `@casfa/oauth-consumer`'s `createMockJwtVerifier` and applies
 * UUID → `usr_` subject conversion (matching Cognito verifier behavior).
 */
export const createMockJwtVerifier = (secret: string): JwtVerifier => {
  const base = createMockJwtVerifierBase(secret);
  return async (token: string) => {
    const result = await base(token);
    if (!result.ok) return result;
    const sub = result.value.subject;
    return {
      ok: true,
      value: {
        ...result.value,
        subject: sub.startsWith("usr_") ? sub : uuidToUserId(sub),
      },
    };
  };
};

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a mock JWT token for testing.
 *
 * **Note**: This is now async (unlike the previous sync version).
 * Uses Web Crypto API via `@casfa/oauth-consumer`.
 */
export const createMockJwt = createMockJwtBase;
