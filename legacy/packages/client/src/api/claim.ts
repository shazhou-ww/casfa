/**
 * Claim API functions.
 *
 * Token Requirement:
 * - POST /api/realm/{realmId}/nodes/{key}/claim: Access Token with canUpload (legacy)
 * - POST /api/realm/{realmId}/nodes/claim: Access Token with canUpload (batch)
 */

import type {
  BatchClaimRequest,
  BatchClaimResponse,
  ClaimNodeRequest,
  ClaimNodeResponse,
} from "@casfa/protocol";
import type { FetchResult } from "../types/client.ts";
import { fetchWithAuth } from "../utils/http.ts";

/**
 * Claim ownership of a CAS node via Proof-of-Possession (legacy single claim).
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

/**
 * Batch claim ownership of CAS nodes.
 * Supports PoP and path-based claims in a single request.
 * Requires Access Token with canUpload permission.
 */
export const batchClaimNodes = async (
  baseUrl: string,
  realm: string,
  accessTokenBase64: string,
  params: BatchClaimRequest
): Promise<FetchResult<BatchClaimResponse>> => {
  return fetchWithAuth<BatchClaimResponse>(
    `${baseUrl}/api/realm/${encodeURIComponent(realm)}/nodes/claim`,
    `Bearer ${accessTokenBase64}`,
    {
      method: "POST",
      body: params,
    }
  );
};
