/**
 * Claim API functions.
 *
 * Token Requirement:
 * - POST /api/realm/{realmId}/nodes/{key}/claim: Access Token with canUpload
 */

import type { ClaimNodeRequest, ClaimNodeResponse } from "@casfa/protocol";
import type { FetchResult } from "../types/client.ts";
import { fetchWithAuth } from "../utils/http.ts";

/**
 * Claim ownership of a CAS node via Proof-of-Possession.
 * Requires Access Token with canUpload permission.
 */
export const claimNode = async (
  baseUrl: string,
  realm: string,
  accessTokenBase64: string,
  nodeKey: string,
  params: ClaimNodeRequest
): Promise<FetchResult<ClaimNodeResponse>> => {
  return fetchWithAuth<ClaimNodeResponse>(
    `${baseUrl}/api/realm/${encodeURIComponent(realm)}/nodes/${encodeURIComponent(nodeKey)}/claim`,
    `Bearer ${accessTokenBase64}`,
    {
      method: "POST",
      body: params,
    }
  );
};
