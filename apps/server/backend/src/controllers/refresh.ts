/**
 * Refresh Token Controller (token-simplification v3)
 *
 * POST /api/auth/refresh — Binary RT → new RT + new AT (rotation)
 *
 * Simplified flow: delegates to shared refreshDelegateToken() service.
 * This endpoint uses the internal response format (not OAuth).
 */

import { RT_SIZE } from "@casfa/delegate-token";
import type { Context } from "hono";
import type { DelegatesDb } from "../db/delegates.ts";
import { RefreshError, refreshDelegateToken } from "../services/delegate-refresh.ts";
import type { Env } from "../types.ts";

// ============================================================================
// Types
// ============================================================================

export type RefreshControllerDeps = {
  delegatesDb: DelegatesDb;
};

export type RefreshController = {
  refresh: (c: Context<Env>) => Promise<Response>;
};

// ============================================================================
// Controller Factory
// ============================================================================

export const createRefreshController = (deps: RefreshControllerDeps): RefreshController => {
  const { delegatesDb } = deps;

  /**
   * POST /api/auth/refresh
   *
   * RT is passed via Authorization: Bearer {base64} header.
   * Returns internal format: { refreshToken, accessToken, accessTokenExpiresAt, delegateId }
   */
  const refresh = async (c: Context<Env>): Promise<Response> => {
    // 1. Extract RT from Authorization header
    const authHeader = c.req.header("Authorization");
    if (!authHeader) {
      return c.json({ error: "UNAUTHORIZED", message: "Missing Authorization header" }, 401);
    }

    const parts = authHeader.split(" ");
    if (parts.length !== 2 || parts[0] !== "Bearer") {
      return c.json({ error: "UNAUTHORIZED", message: "Invalid Authorization header format" }, 401);
    }

    const tokenBase64 = parts[1]!;

    // 2. Decode RT binary — must be 24 bytes
    let tokenBytes: Uint8Array;
    try {
      const buffer = Buffer.from(tokenBase64, "base64");
      if (buffer.length !== RT_SIZE) {
        return c.json(
          { error: "INVALID_TOKEN_FORMAT", message: `Refresh Token must be ${RT_SIZE} bytes` },
          401,
        );
      }
      tokenBytes = new Uint8Array(buffer);
    } catch {
      return c.json({ error: "INVALID_TOKEN_FORMAT", message: "Invalid Base64 encoding" }, 401);
    }

    // 3. Delegate to shared refresh logic
    try {
      const result = await refreshDelegateToken(tokenBytes, { delegatesDb });
      return c.json({
        refreshToken: result.newRefreshToken,
        accessToken: result.newAccessToken,
        accessTokenExpiresAt: result.accessTokenExpiresAt,
        delegateId: result.delegateId,
      });
    } catch (error) {
      if (error instanceof RefreshError) {
        return c.json(
          { error: error.code, message: error.message },
          error.statusCode as 400 | 401 | 409,
        );
      }
      throw error;
    }
  };

  return { refresh };
};
