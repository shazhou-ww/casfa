/**
 * Token API functions (new 2-tier model).
 *
 * Token Endpoint:
 * - POST /api/tokens/refresh: Bearer RT → new RT + AT (child delegates only)
 *
 * Root delegates no longer need a dedicated endpoint — the server's
 * access-token-auth middleware auto-creates the root delegate on first
 * JWT-authenticated request.
 */

import type { RefreshTokenResponse } from "@casfa/protocol";
import type { FetchResult } from "../types/client.ts";
import { fetchWithAuth } from "../utils/http.ts";

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
