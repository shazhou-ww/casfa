/**
 * Access Token Authentication Middleware (token-simplification v3)
 *
 * Supports two authentication modes via Authorization: Bearer header:
 *
 * 1. **Access Token (AT)** — 32-byte binary (base64-encoded, no `.` chars)
 *    - Decode → extract delegateId → DB lookup → hash verification
 *    - Used by child delegates (depth > 0)
 *
 * 2. **JWT** — standard `header.payload.signature` format (contains `.`)
 *    - Verify JWT → resolve userId → look up root delegate (depth=0) by realm
 *    - Used by root/owner operations from any device
 *    - Solves the multi-device root delegate invalidation problem
 *
 * Both paths produce the same `AccessTokenAuthContext`, so all downstream
 * middleware and controllers work without any changes.
 */

import { AT_SIZE, decodeToken } from "@casfa/delegate-token";
import type { MiddlewareHandler } from "hono";
import type { DelegatesDb } from "../db/delegates.ts";
import type { UserRolesDb } from "../db/user-roles.ts";
import type { AccessTokenAuthContext, Env } from "../types.ts";
import { bytesToDelegateId, computeTokenHash } from "../util/delegate-token-utils.ts";
import { generateDelegateId } from "../util/token-id.ts";
import type { JwtVerifier } from "./jwt-auth.ts";

// ============================================================================
// Types
// ============================================================================

export type AccessTokenMiddlewareDeps = {
  delegatesDb: DelegatesDb;
  /** JWT verifier — reused from jwt-auth middleware (for root JWT path) */
  jwtVerifier: JwtVerifier;
  /** User roles DB — check authorized status (for root JWT path) */
  userRolesDb: UserRolesDb;
};

// ============================================================================
// Middleware Factory
// ============================================================================

/**
 * Create Access Token authentication middleware.
 *
 * Validates either an Access Token or a JWT Bearer token and sets `auth`
 * on the Hono context with the associated Delegate entity's permissions.
 */
export const createAccessTokenMiddleware = (
  deps: AccessTokenMiddlewareDeps
): MiddlewareHandler<Env> => {
  const { delegatesDb, jwtVerifier, userRolesDb } = deps;

  return async (c, next) => {
    // 1. Extract Authorization header
    const authHeader = c.req.header("Authorization");
    if (!authHeader) {
      return c.json({ error: "UNAUTHORIZED", message: "Missing Authorization header" }, 401);
    }

    const parts = authHeader.split(" ");
    if (parts.length !== 2 || parts[0] !== "Bearer") {
      return c.json({ error: "UNAUTHORIZED", message: "Invalid Authorization header format" }, 401);
    }

    const tokenString = parts[1]!;

    // ── Detect token type: JWT contains '.', AT base64 does not ──
    if (tokenString.includes(".")) {
      return handleJwtAuth(c, next, tokenString, delegatesDb, jwtVerifier, userRolesDb);
    }

    return handleAccessTokenAuth(c, next, tokenString, delegatesDb);
  };
};

// ============================================================================
// JWT Auth Path (root delegate via user JWT)
// ============================================================================

/**
 * Handle JWT bearer authentication for root delegate operations.
 *
 * Flow: verify JWT → check user role → look up root delegate → build auth context.
 */
const handleJwtAuth = async (
  c: Parameters<MiddlewareHandler<Env>>[0],
  next: () => Promise<void>,
  token: string,
  delegatesDb: DelegatesDb,
  jwtVerifier: JwtVerifier,
  userRolesDb: UserRolesDb
): Promise<Response | undefined> => {
  // 1. Verify JWT
  let result;
  try {
    result = await jwtVerifier(token);
  } catch {
    return c.json({ error: "UNAUTHORIZED", message: "JWT verification failed" }, 401);
  }

  if (!result) {
    return c.json({ error: "UNAUTHORIZED", message: "Invalid JWT" }, 401);
  }

  const { userId, exp } = result;

  // 2. Check JWT expiration
  if (exp && exp * 1000 < Date.now()) {
    return c.json({ error: "TOKEN_EXPIRED", message: "JWT has expired" }, 401);
  }

  // 3. Check user role is authorized
  const role = await userRolesDb.getRole(userId);
  if (role === "unauthorized") {
    return c.json({ error: "FORBIDDEN", message: "User is not authorized" }, 403);
  }

  // 4. Auto-create root delegate if it doesn't exist (realm = userId)
  const { delegate: rootDelegate } = await delegatesDb.getOrCreateRoot(
    userId,
    generateDelegateId()
  );

  if (rootDelegate.isRevoked) {
    return c.json({ error: "DELEGATE_REVOKED", message: "Root delegate has been revoked" }, 401);
  }

  // 5. Build auth context — same shape as AT path
  const auth: AccessTokenAuthContext = {
    type: "access",
    tokenBytes: new Uint8Array(0), // JWT has no token bytes (PoP N/A for root)
    delegate: rootDelegate,
    delegateId: rootDelegate.delegateId,
    realm: rootDelegate.realm,
    canUpload: rootDelegate.canUpload,
    canManageDepot: rootDelegate.canManageDepot,
    issuerChain: rootDelegate.chain,
  };

  c.set("auth", auth);
  await next();
};

// ============================================================================
// Access Token Auth Path (child delegates via 32-byte AT)
// ============================================================================

/**
 * Handle binary Access Token authentication (original path).
 */
const handleAccessTokenAuth = async (
  c: Parameters<MiddlewareHandler<Env>>[0],
  next: () => Promise<void>,
  tokenBase64: string,
  delegatesDb: DelegatesDb
): Promise<Response | undefined> => {
  // 1. Decode token bytes — must be 32 bytes (AT)
  let tokenBytes: Uint8Array;
  try {
    const buffer = Buffer.from(tokenBase64, "base64");
    if (buffer.length !== AT_SIZE) {
      return c.json(
        { error: "INVALID_TOKEN_FORMAT", message: `Access Token must be ${AT_SIZE} bytes` },
        401
      );
    }
    tokenBytes = new Uint8Array(buffer);
  } catch {
    return c.json({ error: "INVALID_TOKEN_FORMAT", message: "Invalid Base64 encoding" }, 401);
  }

  // 2. Decode token to extract delegateId
  let decoded;
  try {
    decoded = decodeToken(tokenBytes);
  } catch {
    return c.json({ error: "INVALID_TOKEN_FORMAT", message: "Invalid token format" }, 401);
  }

  if (decoded.type !== "access") {
    return c.json(
      { error: "ACCESS_TOKEN_REQUIRED", message: "This endpoint requires an Access Token" },
      403
    );
  }

  // Convert raw delegateId bytes → dlt_CB32 string
  const delegateId = bytesToDelegateId(decoded.delegateId);

  // 3. Look up Delegate — single DB read
  const delegate = await delegatesDb.get(delegateId);

  if (!delegate) {
    return c.json({ error: "DELEGATE_NOT_FOUND", message: "Associated delegate not found" }, 401);
  }

  // 4. Check delegate revoked
  if (delegate.isRevoked) {
    return c.json({ error: "DELEGATE_REVOKED", message: "The delegate has been revoked" }, 401);
  }

  // Check delegate expired
  if (delegate.expiresAt && delegate.expiresAt < Date.now()) {
    return c.json({ error: "DELEGATE_EXPIRED", message: "The delegate has expired" }, 401);
  }

  // 5. Verify AT hash matches
  const atHash = computeTokenHash(tokenBytes);
  if (atHash !== delegate.currentAtHash) {
    return c.json({ error: "TOKEN_INVALID", message: "Access token is no longer valid" }, 401);
  }

  // 6. Check AT expiration (from delegate's stored atExpiresAt)
  if (delegate.atExpiresAt < Date.now()) {
    return c.json({ error: "TOKEN_EXPIRED", message: "Access token has expired" }, 401);
  }

  // 7. Build auth context from Delegate
  const auth: AccessTokenAuthContext = {
    type: "access",
    tokenBytes,
    delegate,
    delegateId: delegate.delegateId,
    realm: delegate.realm,
    canUpload: delegate.canUpload,
    canManageDepot: delegate.canManageDepot,
    issuerChain: delegate.chain,
  };

  c.set("auth", auth);
  await next();
};
