/**
 * JWT Verifier
 *
 * Factory functions to create JWT verifiers:
 * - {@link createJwtVerifier} — production JWKS-based verification
 * - {@link createMockJwtVerifier} — HMAC-based verification for dev/test
 * - {@link createMockJwt} — generate mock JWTs for testing
 *
 * All verifiers return {@link Result<VerifiedIdentity>}, never throw.
 */

import { createRemoteJWKSet, jwtVerify } from "jose";
import type { JwtVerifier, Result, VerifiedIdentity } from "./types.ts";

// ============================================================================
// JWKS Verifier (Production)
// ============================================================================

/**
 * Configuration for {@link createJwtVerifier}.
 */
export type JwtVerifierConfig = {
  /** JWKS endpoint URL (e.g. `https://.../.well-known/jwks.json`) */
  jwksUri: string;
  /** Expected issuer claim */
  issuer: string;
  /** Expected audience claim (optional) */
  audience?: string;
  /**
   * Custom subject extraction from JWT claims.
   * Default: `(claims) => claims.sub as string`
   *
   * @example
   * ```ts
   * // Convert Cognito UUID to internal user ID format
   * extractSubject: (claims) => `usr_${claims.sub}`
   * ```
   */
  extractSubject?: (claims: Record<string, unknown>) => string;
};

/**
 * Create a JWT verifier that validates tokens against a remote JWKS endpoint.
 *
 * Internally caches the JWKS key set and handles key rotation automatically
 * (via `jose`'s `createRemoteJWKSet`).
 *
 * @param config - Verifier configuration
 * @returns A {@link JwtVerifier} function
 *
 * @example
 * ```ts
 * const verify = createJwtVerifier({
 *   jwksUri: "https://cognito-idp.us-east-1.amazonaws.com/POOL/.well-known/jwks.json",
 *   issuer: "https://cognito-idp.us-east-1.amazonaws.com/POOL",
 *   extractSubject: (claims) => `usr_${claims.sub}`,
 * });
 *
 * const result = await verify(bearerToken);
 * if (result.ok) {
 *   console.log(result.value.subject); // "usr_abc123"
 * }
 * ```
 */
export function createJwtVerifier(config: JwtVerifierConfig): JwtVerifier {
  console.log(`[JWT] Creating verifier with JWKS URI: ${config.jwksUri}`);
  const jwks = createRemoteJWKSet(new URL(config.jwksUri));
  const extractSubject = config.extractSubject ?? ((claims) => claims.sub as string);

  return async (token: string): Promise<Result<VerifiedIdentity>> => {
    const startTime = Date.now();
    console.log(`[JWT] Starting verification, token length: ${token.length}`);
    try {
      console.log(`[JWT] Calling jwtVerify (will fetch JWKS if not cached)...`);
      const { payload } = await jwtVerify(token, jwks, {
        issuer: config.issuer,
        audience: config.audience,
      });
      console.log(`[JWT] Verification succeeded in ${Date.now() - startTime}ms`);

      const claims = payload as Record<string, unknown>;
      const subject = extractSubject(claims);
      if (!subject) {
        return {
          ok: false,
          error: { code: "invalid_token", message: "JWT missing subject claim", statusCode: 401 },
        };
      }

      return {
        ok: true,
        value: {
          subject,
          email: claims.email as string | undefined,
          name: claims.name as string | undefined,
          expiresAt: payload.exp,
          rawClaims: claims,
        },
      };
    } catch (err) {
      const elapsed = Date.now() - startTime;
      const errMsg = err instanceof Error ? err.message : String(err);
      const errName = err instanceof Error ? err.name : "Unknown";
      console.error(`[JWT] Verification FAILED after ${elapsed}ms`);
      console.error(`[JWT] Error name: ${errName}`);
      console.error(`[JWT] Error message: ${errMsg}`);
      if (err instanceof Error && err.stack) {
        console.error(`[JWT] Stack: ${err.stack}`);
      }
      return {
        ok: false,
        error: {
          code: "invalid_token",
          message: `JWT verification failed: ${errMsg}`,
          statusCode: 401,
        },
      };
    }
  };
}

// ============================================================================
// Mock Verifier (Dev/Test)
// ============================================================================

/**
 * Base64URL-encode a buffer.
 */
function toBase64Url(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let binary = "";
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Compute HMAC-SHA256 using Web Crypto API.
 */
async function hmacSha256(secret: string, data: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(data));
  return toBase64Url(signature);
}

/**
 * Create a mock JWT verifier for development and testing.
 *
 * Validates tokens signed with HMAC-SHA256 using the provided secret.
 * Does NOT contact any JWKS endpoint.
 *
 * @param secret - The HMAC signing secret
 * @returns A {@link JwtVerifier} function
 */
export function createMockJwtVerifier(secret: string): JwtVerifier {
  return async (token: string): Promise<Result<VerifiedIdentity>> => {
    try {
      const parts = token.split(".");
      if (parts.length !== 3) {
        return {
          ok: false,
          error: { code: "invalid_token", message: "Invalid JWT format", statusCode: 401 },
        };
      }

      const [headerB64, payloadB64, signatureB64] = parts as [string, string, string];

      // Verify HMAC-SHA256 signature
      const expectedSignature = await hmacSha256(secret, `${headerB64}.${payloadB64}`);
      if (signatureB64 !== expectedSignature) {
        return {
          ok: false,
          error: { code: "invalid_token", message: "Invalid JWT signature", statusCode: 401 },
        };
      }

      // Decode payload
      const payloadJson = atob(payloadB64.replace(/-/g, "+").replace(/_/g, "/"));
      const claims = JSON.parse(payloadJson) as Record<string, unknown>;

      const sub = claims.sub as string | undefined;
      if (!sub) {
        return {
          ok: false,
          error: { code: "invalid_token", message: "JWT missing subject claim", statusCode: 401 },
        };
      }

      // Check expiration
      const exp = claims.exp as number | undefined;
      if (exp && exp * 1000 < Date.now()) {
        return {
          ok: false,
          error: { code: "invalid_token", message: "JWT has expired", statusCode: 401 },
        };
      }

      return {
        ok: true,
        value: {
          subject: sub,
          email: claims.email as string | undefined,
          name: claims.name as string | undefined,
          expiresAt: exp,
          rawClaims: claims,
        },
      };
    } catch {
      return {
        ok: false,
        error: { code: "invalid_token", message: "Failed to decode JWT", statusCode: 401 },
      };
    }
  };
}

/**
 * Create a mock JWT token for testing purposes.
 *
 * Signs the token with HMAC-SHA256. Compatible with {@link createMockJwtVerifier}.
 *
 * @param secret - The HMAC signing secret
 * @param payload - JWT claims (must include `sub`)
 * @returns A signed JWT string
 *
 * @example
 * ```ts
 * const jwt = await createMockJwt("secret", { sub: "user_123", email: "a@b.com" });
 * const result = await createMockJwtVerifier("secret")(jwt);
 * // result.ok === true, result.value.subject === "user_123"
 * ```
 */
export async function createMockJwt(
  secret: string,
  payload: { sub: string; exp?: number; [key: string]: unknown }
): Promise<string> {
  const header = { alg: "HS256", typ: "JWT" };

  const encoder = new TextEncoder();
  const headerB64 = toBase64Url(encoder.encode(JSON.stringify(header)));
  const payloadB64 = toBase64Url(encoder.encode(JSON.stringify(payload)));

  const signature = await hmacSha256(secret, `${headerB64}.${payloadB64}`);
  return `${headerB64}.${payloadB64}.${signature}`;
}
