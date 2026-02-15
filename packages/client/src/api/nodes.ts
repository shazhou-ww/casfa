/**
 * Node API functions.
 *
 * Token Requirement:
 * - GET /nodes/raw/:nodeKey: Access Token (Direct Authorization Check)
 * - GET /nodes/metadata/:nodeKey: Access Token (Direct Authorization Check)
 * - POST /nodes/check: Access Token
 * - PUT /nodes/raw/:nodeKey: Access Token with canUpload
 */

import type { CheckNodes, CheckNodesResponse, NodeMetadata } from "@casfa/protocol";
import type { FetchResult } from "../types/client.ts";
import { fetchWithAuth } from "../utils/http.ts";

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
 * Requires Access Token with Direct Authorization on the nodeKey.
 */
export const getNode = async (
  baseUrl: string,
  realm: string,
  accessTokenBase64: string,
  nodeKey: string
): Promise<FetchResult<Uint8Array>> => {
  const url = `${baseUrl}/api/realm/${encodeURIComponent(realm)}/nodes/raw/${encodeURIComponent(nodeKey)}`;

  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessTokenBase64}`,
    };

    const response = await fetch(url, { headers });

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
 * Get node content via navigation path (GET /nodes/raw/:key/~0/~1/...).
 * Requires Access Token with Direct Authorization on the starting nodeKey.
 */
export const getNodeNavigated = async (
  baseUrl: string,
  realm: string,
  accessTokenBase64: string,
  nodeKey: string,
  indexPath: string
): Promise<FetchResult<Uint8Array>> => {
  const url = `${baseUrl}/api/realm/${encodeURIComponent(realm)}/nodes/raw/${encodeURIComponent(nodeKey)}/${indexPath}`;

  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${accessTokenBase64}`,
    };

    const response = await fetch(url, { headers });

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
 * Requires Access Token with Direct Authorization on the nodeKey.
 */
export const getNodeMetadata = async (
  baseUrl: string,
  realm: string,
  accessTokenBase64: string,
  nodeKey: string
): Promise<FetchResult<NodeMetadata>> => {
  return fetchWithAuth<NodeMetadata>(
    `${baseUrl}/api/realm/${encodeURIComponent(realm)}/nodes/metadata/${encodeURIComponent(nodeKey)}`,
    `Bearer ${accessTokenBase64}`
  );
};

/**
 * Check nodes status on the server.
 * Returns three-way classification: missing, owned, unowned.
 * Requires Access Token.
 */
export const checkNodes = async (
  baseUrl: string,
  realm: string,
  accessTokenBase64: string,
  params: CheckNodes
): Promise<FetchResult<CheckNodesResponse>> => {
  return fetchWithAuth<CheckNodesResponse>(
    `${baseUrl}/api/realm/${encodeURIComponent(realm)}/nodes/check`,
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
  const url = `${baseUrl}/api/realm/${encodeURIComponent(realm)}/nodes/raw/${encodeURIComponent(nodeKey)}`;

  try {
    const response = await fetch(url, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${accessTokenBase64}`,
        "Content-Type": "application/octet-stream",
      },
      // Uint8Array is valid as fetch body in all runtimes, but TS lib
      // variations (DOM vs Node vs ESNext) disagree on the exact type.
      body: content as any, // eslint-disable-line @typescript-eslint/no-explicit-any
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
