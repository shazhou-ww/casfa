/**
 * Dual-Mode Bearer Token Authentication
 *
 * Automatically detects JWT vs opaque token based on the presence
 * of `.` characters in the Bearer token, then delegates to the
 * appropriate verifier. Both paths produce the same `TContext` type,
 * making downstream code auth-mode agnostic.
 */

import type { JwtVerifier, OpaqueTokenVerifier, Result } from "./types.ts";

// ============================================================================
// Types
// ============================================================================

/**
 * Configuration for {@link createDualAuthHandler}.
 */
export type DualAuthConfig<TContext> = {
  /**
   * JWT verifier — called when the token contains `.` characters.
   *
   * Typically created via `@casfa/oauth-consumer`'s `createJwtVerifier()`.
   */
  jwtVerifier: JwtVerifier;

  /**
   * Build a business auth context from the verified JWT identity.
   *
   * This is where you look up user roles, create/get root delegates,
   * and assemble the application-specific auth context.
   */
  buildContextFromJwt: (identity: {
    subject: string;
    email?: string;
    name?: string;
    expiresAt?: number;
    rawClaims: Record<string, unknown>;
  }) => Promise<Result<TContext>>;

  /**
   * Opaque token verifier — called when the token does NOT contain `.` characters.
   *
   * Receives the raw token bytes (base64-decoded). The implementation should
   * decode the token, look up the associated entity (e.g. delegate),
   * verify the hash, and return the auth context.
   */
  opaqueVerifier: OpaqueTokenVerifier<TContext>;
};

// ============================================================================
// Dual Auth Handler
// ============================================================================

/**
 * Create a dual-mode Bearer token authentication handler.
 *
 * Returns a function that:
 * 1. Extracts the token from the `Authorization: Bearer {token}` header
 * 2. Detects token type:
 *    - Contains `.` → JWT path → `jwtVerifier` + `buildContextFromJwt`
 *    - No `.` → Opaque path → base64 decode → `opaqueVerifier`
 * 3. Returns a unified `TContext` (or error)
 *
 * @typeParam TContext - Application-specific auth context type
 * @param config - Verifier + context builder configuration
 * @returns An async function: `(authorizationHeader: string) => Promise<Result<TContext>>`
 *
 * @example
 * ```ts
 * const authenticate = createDualAuthHandler<MyAuthContext>({
 *   jwtVerifier: createJwtVerifier({ jwksUri: "...", issuer: "..." }),
 *   buildContextFromJwt: async (identity) => {
 *     const user = await db.getUser(identity.subject);
 *     return { ok: true, value: { userId: user.id, role: user.role } };
 *   },
 *   opaqueVerifier: async (bytes) => {
 *     const token = decodeToken(bytes);
 *     const delegate = await db.getDelegate(token.delegateId);
 *     return { ok: true, value: { delegateId: delegate.id, ... } };
 *   },
 * });
 *
 * // In middleware:
 * const result = await authenticate(c.req.header("Authorization") ?? "");
 * if (!result.ok) return c.json(result.error, result.error.statusCode);
 * c.set("auth", result.value);
 * ```
 */
export function createDualAuthHandler<TContext>(
  config: DualAuthConfig<TContext>
): (authorizationHeader: string) => Promise<Result<TContext>> {
  return async (authorizationHeader: string): Promise<Result<TContext>> => {
    // Extract Bearer token
    if (!authorizationHeader) {
      return {
        ok: false,
        error: {
          code: "missing_token",
          message: "Missing Authorization header",
          statusCode: 401,
        },
      };
    }

    const parts = authorizationHeader.split(" ");
    if (parts.length !== 2 || parts[0] !== "Bearer") {
      return {
        ok: false,
        error: {
          code: "missing_token",
          message: "Invalid Authorization header format, expected: Bearer {token}",
          statusCode: 401,
        },
      };
    }

    const tokenString = parts[1]!;

    // Detect token type by presence of "." (JWT uses "." as separator)
    if (tokenString.includes(".")) {
      return handleJwtToken(tokenString, config);
    }
    return handleOpaqueToken(tokenString, config);
  };
}

// ============================================================================
// Internal Handlers
// ============================================================================

/**
 * JWT path: verify → extract identity → build context
 */
async function handleJwtToken<TContext>(
  token: string,
  config: DualAuthConfig<TContext>
): Promise<Result<TContext>> {
  const verifyResult = await config.jwtVerifier(token);
  if (!verifyResult.ok) {
    return {
      ok: false,
      error: {
        code: verifyResult.error.code,
        message: verifyResult.error.message,
        statusCode: verifyResult.error.statusCode,
      },
    };
  }

  return config.buildContextFromJwt(verifyResult.value);
}

/**
 * Opaque token path: base64 decode → verify
 */
async function handleOpaqueToken<TContext>(
  tokenBase64: string,
  config: DualAuthConfig<TContext>
): Promise<Result<TContext>> {
  let tokenBytes: Uint8Array;
  try {
    // Use atob for base64 decoding (works in all JS runtimes)
    const binary = atob(tokenBase64);
    tokenBytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      tokenBytes[i] = binary.charCodeAt(i);
    }
  } catch {
    return {
      ok: false,
      error: {
        code: "invalid_token",
        message: "Invalid Base64 encoding in bearer token",
        statusCode: 401,
      },
    };
  }

  return config.opaqueVerifier(tokenBytes);
}
