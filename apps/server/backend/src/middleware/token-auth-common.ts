/**
 * Common Token Authentication Logic
 *
 * Shared validation logic for Delegate Token and Access Token authentication.
 * Based on docs/delegate-token-refactor/impl/03-middleware-refactor.md
 */

import type { Context } from "hono";
import type { DelegateTokensDb } from "../db/delegate-tokens.ts";
import type { DelegateTokenRecord } from "../types/delegate-token.ts";
import type { Env } from "../types.ts";
import { computeTokenId, decodeToken, TOKEN_SIZE, type DecodedDelegateToken } from "../util/token.ts";

// ============================================================================
// Types
// ============================================================================

export type TokenValidationSuccess = {
  success: true;
  tokenId: string;
  tokenBytes: Uint8Array;
  tokenRecord: DelegateTokenRecord;
  decoded: DecodedDelegateToken;
};

export type TokenValidationFailure = {
  success: false;
  error: string;
  message: string;
  status: 401 | 403;
};

export type TokenValidationResult = TokenValidationSuccess | TokenValidationFailure;

// ============================================================================
// Validation Function
// ============================================================================

/**
 * Extract and validate a token from request Authorization header
 *
 * @param c - Hono context
 * @param delegateTokensDb - Database for token lookup
 * @returns Validation result with token info or error
 */
export async function validateToken(
  c: Context<Env>,
  delegateTokensDb: DelegateTokensDb
): Promise<TokenValidationResult> {
  const authHeader = c.req.header("Authorization");
  if (!authHeader) {
    return {
      success: false,
      error: "UNAUTHORIZED",
      message: "Missing Authorization header",
      status: 401,
    };
  }

  const parts = authHeader.split(" ");
  if (parts.length !== 2 || parts[0] !== "Bearer") {
    return {
      success: false,
      error: "UNAUTHORIZED",
      message: "Invalid Authorization header format",
      status: 401,
    };
  }

  const tokenBase64 = parts[1]!;

  // Decode token from Base64
  let tokenBytes: Uint8Array;
  try {
    const buffer = Buffer.from(tokenBase64, "base64");
    if (buffer.length !== TOKEN_SIZE) {
      return {
        success: false,
        error: "INVALID_TOKEN_FORMAT",
        message: `Token must be ${TOKEN_SIZE} bytes`,
        status: 401,
      };
    }
    tokenBytes = new Uint8Array(buffer);
  } catch {
    return {
      success: false,
      error: "INVALID_TOKEN_FORMAT",
      message: "Invalid Base64 encoding",
      status: 401,
    };
  }

  // Compute Token ID and look up in database
  const tokenId = computeTokenId(tokenBytes);
  const tokenRecord = await delegateTokensDb.getValid(tokenId);

  if (!tokenRecord) {
    return {
      success: false,
      error: "TOKEN_NOT_FOUND",
      message: "Token not found or invalid",
      status: 401,
    };
  }

  // Check if revoked
  if (tokenRecord.isRevoked) {
    return {
      success: false,
      error: "TOKEN_REVOKED",
      message: "Token has been revoked",
      status: 401,
    };
  }

  // Check if expired
  if (tokenRecord.expiresAt < Date.now()) {
    return {
      success: false,
      error: "TOKEN_EXPIRED",
      message: "Token has expired",
      status: 401,
    };
  }

  // Decode token binary format
  let decoded: DecodedDelegateToken;
  try {
    decoded = decodeToken(tokenBytes);
  } catch (e) {
    return {
      success: false,
      error: "INVALID_TOKEN_FORMAT",
      message: e instanceof Error ? e.message : "Invalid token format",
      status: 401,
    };
  }

  // Note: Ancestor revocation check is handled by cascade revocation.
  // When a parent token is revoked, all children are also marked as revoked.
  // The isRevoked check above is sufficient.

  return {
    success: true,
    tokenId,
    tokenBytes,
    tokenRecord,
    decoded,
  };
}
