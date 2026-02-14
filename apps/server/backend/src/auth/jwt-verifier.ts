/**
 * JWT Verifier Factories
 *
 * Provides factory functions to create JWT verifiers for different scenarios:
 * - Cognito JWT verifier for production
 * - Mock JWT verifier for testing
 */

import { createHmac } from "node:crypto";
import { base64urlDecode } from "@casfa/encoding";
import { createRemoteJWKSet, jwtVerify } from "jose";
import type { CognitoConfig } from "../config.ts";
import type { JwtVerifier } from "../middleware/jwt-auth.ts";
import { uuidToUserId } from "../util/encoding.ts";

// ============================================================================
// Cognito JWT Verifier
// ============================================================================

/**
 * Create a Cognito JWT verifier
 *
 * Verifies tokens against Cognito's JWKS endpoint.
 */
export const createCognitoJwtVerifier = (config: CognitoConfig): JwtVerifier => {
  const jwksUrl = `https://cognito-idp.${config.region}.amazonaws.com/${config.userPoolId}/.well-known/jwks.json`;
  const jwks = createRemoteJWKSet(new URL(jwksUrl));
  const issuer = `https://cognito-idp.${config.region}.amazonaws.com/${config.userPoolId}`;

  return async (token: string) => {
    try {
      const { payload } = await jwtVerify(token, jwks, { issuer });

      const sub = payload.sub;
      if (!sub) return null;

      // Convert Cognito UUID to usr_ format
      const userId = uuidToUserId(sub);

      return {
        userId,
        exp: payload.exp,
        email: payload.email as string | undefined,
        name: payload.name as string | undefined,
      };
    } catch {
      return null;
    }
  };
};

// ============================================================================
// Mock JWT Verifier
// ============================================================================

/**
 * Decode base64url to UTF-8 string
 */
const base64UrlDecodeString = (input: string): string =>
  new TextDecoder().decode(base64urlDecode(input));

/**
 * Create a mock JWT verifier for testing
 *
 * Verifies tokens using HMAC-SHA256 with the provided secret.
 * Expects tokens in standard JWT format with 'sub' claim for user ID.
 *
 * @param secret - The secret key used to sign/verify tokens
 */
export const createMockJwtVerifier = (secret: string): JwtVerifier => {
  return async (token: string) => {
    try {
      const parts = token.split(".");
      if (parts.length !== 3) return null;

      const [headerB64, payloadB64, signatureB64] = parts as [string, string, string];

      // Verify signature using HMAC-SHA256
      const signatureInput = `${headerB64}.${payloadB64}`;
      const expectedSignature = createHmac("sha256", secret)
        .update(signatureInput)
        .digest("base64url");

      if (signatureB64 !== expectedSignature) return null;

      // Parse payload
      const payloadJson = base64UrlDecodeString(payloadB64);
      const payload = JSON.parse(payloadJson) as { sub?: string; exp?: number };

      const sub = payload.sub;
      if (!sub) return null;

      // Check expiration
      if (payload.exp && payload.exp * 1000 < Date.now()) {
        return null;
      }

      // Convert UUID to usr_ format (for mock tokens, sub may already be in usr_ format)
      const userId = sub.startsWith("usr_") ? sub : uuidToUserId(sub);

      return {
        userId,
        exp: payload.exp,
      };
    } catch {
      return null;
    }
  };
};

// ============================================================================
// Test Helpers
// ============================================================================

/**
 * Create a mock JWT token for testing
 *
 * @param secret - The secret key to sign the token
 * @param payload - The token payload (should include 'sub' for user ID)
 * @returns A signed JWT token string
 */
export const createMockJwt = (
  secret: string,
  payload: { sub: string; exp?: number; [key: string]: unknown }
): string => {
  const header = { alg: "HS256", typ: "JWT" };
  const headerB64 = Buffer.from(JSON.stringify(header)).toString("base64url");
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");

  const signatureInput = `${headerB64}.${payloadB64}`;
  const signature = createHmac("sha256", secret).update(signatureInput).digest("base64url");

  return `${headerB64}.${payloadB64}.${signature}`;
};
