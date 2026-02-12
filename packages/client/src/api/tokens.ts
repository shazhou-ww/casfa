/**
 * Token API functions (new 2-tier model).
 *
 * Token Requirement:
 * - POST /api/tokens/root: User JWT → Root Delegate metadata (no RT/AT)
 * - POST /api/tokens/refresh: Bearer RT → new RT + AT (child delegates only)
 */

import type { RefreshTokenResponse, RootTokenResponse } from "@casfa/protocol";
import type { FetchResult } from "../types/client.ts";
import { fetchWithAuth } from "../utils/http.ts";

// ============================================================================
// Root Token API (JWT → Root Delegate metadata)
// ============================================================================

/**
 * Ensure root delegate exists and get its metadata.
 * Requires User JWT. No RT/AT returned — root uses JWT directly.
 */
export const createRootToken = async (
  baseUrl: string,
  userAccessToken: string,
  realm: string
): Promise<FetchResult<RootTokenResponse>> => {
  return fetchWithAuth<RootTokenResponse>(
    `${baseUrl}/api/tokens/root`,
    `Bearer ${userAccessToken}`,
    {
      method: "POST",
      body: { realm },
    }
  );
};

// ============================================================================
// Refresh Token API (RT → new RT + AT, child delegates only)
// ============================================================================

/**
 * Rotate refresh token to get new RT + AT pair.
 * Uses Bearer auth with the refresh token.
 * Only valid for child delegates (depth > 0).
 */
export const refreshToken = async (
  baseUrl: string,
  refreshTokenBase64: string
): Promise<FetchResult<RefreshTokenResponse>> => {
  return fetchWithAuth<RefreshTokenResponse>(
    `${baseUrl}/api/tokens/refresh`,
    `Bearer ${refreshTokenBase64}`,
    {
      method: "POST",
    }
  );
};
