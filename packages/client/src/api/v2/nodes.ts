/**
 * Node API functions.
 *
 * Token Requirement:
 * - GET /nodes/:nodeKey: Access Token (with X-CAS-Index-Path header)
 * - POST /nodes/prepare: Access Token with canUpload
 * - PUT /nodes/:nodeKey: Access Token with canUpload
 */

import type { NodeMetadata, PrepareNodes, PrepareNodesResponse } from "@casfa/protocol";
import type { FetchResult } from "../../types/client.ts";
import { fetchApi, fetchWithAuth } from "../../utils/api-fetch.ts";

// ============================================================================
// Types
// ============================================================================

export type NodeUploadResult = {
  nodeKey: string;
  status: "created" | "exists";
};

// ============================================================================
// Access Token APIs
// ============================================================================

/**
 * Get node content.
 * Requires Access Token with scope covering the index path.
 *
 * @param indexPath - The CAS index path for scope verification (e.g., "depot:MAIN:0:1")
 */
export const getNode = async (
  baseUrl: string,
  realm: string,
  accessTokenBase64: string,
  nodeKey: string,
  indexPath: string
): Promise<FetchResult<Uint8Array>> => {
  const url = `${baseUrl}/api/realm/${encodeURIComponent(realm)}/nodes/${encodeURIComponent(nodeKey)}`;

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessTokenBase64}`,
        "X-CAS-Index-Path": indexPath,
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: response.statusText }));
      return {
        ok: false,
        error: {
          code: String(response.status),
          message: (error as { message?: string }).message ?? response.statusText,
          status: response.status,
        },
      };
    }

    const data = new Uint8Array(await response.arrayBuffer());
    return { ok: true, data, status: response.status };
  } catch (err) {
    return {
      ok: false,
      error: {
        code: "NETWORK_ERROR",
        message: err instanceof Error ? err.message : "Network error",
      },
    };
  }
};

/**
 * Get node metadata.
 * Requires Access Token with scope covering the index path.
 */
export const getNodeMetadata = async (
  baseUrl: string,
  realm: string,
  accessTokenBase64: string,
  nodeKey: string,
  indexPath: string
): Promise<FetchResult<NodeMetadata>> => {
  return fetchWithAuth<NodeMetadata>(
    `${baseUrl}/api/realm/${encodeURIComponent(realm)}/nodes/${encodeURIComponent(nodeKey)}/metadata`,
    `Bearer ${accessTokenBase64}`,
    {
      headers: {
        "X-CAS-Index-Path": indexPath,
      },
    }
  );
};

/**
 * Prepare nodes for upload.
 * Returns which nodes need to be uploaded vs already exist.
 * Requires Access Token with canUpload.
 */
export const prepareNodes = async (
  baseUrl: string,
  realm: string,
  accessTokenBase64: string,
  params: PrepareNodes
): Promise<FetchResult<PrepareNodesResponse>> => {
  return fetchWithAuth<PrepareNodesResponse>(
    `${baseUrl}/api/realm/${encodeURIComponent(realm)}/nodes/prepare`,
    `Bearer ${accessTokenBase64}`,
    {
      method: "POST",
      body: params,
    }
  );
};

/**
 * Upload a node.
 * Requires Access Token with canUpload.
 */
export const putNode = async (
  baseUrl: string,
  realm: string,
  accessTokenBase64: string,
  nodeKey: string,
  content: Uint8Array
): Promise<FetchResult<NodeUploadResult>> => {
  const url = `${baseUrl}/api/realm/${encodeURIComponent(realm)}/nodes/${encodeURIComponent(nodeKey)}`;

  try {
    const response = await fetch(url, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${accessTokenBase64}`,
        "Content-Type": "application/octet-stream",
      },
      body: content,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: response.statusText }));
      return {
        ok: false,
        error: {
          code: String(response.status),
          message: (error as { message?: string }).message ?? response.statusText,
          status: response.status,
        },
      };
    }

    const data = (await response.json()) as NodeUploadResult;
    return { ok: true, data, status: response.status };
  } catch (err) {
    return {
      ok: false,
      error: {
        code: "NETWORK_ERROR",
        message: err instanceof Error ? err.message : "Network error",
      },
    };
  }
};
