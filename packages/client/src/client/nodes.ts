/**
 * Node methods for the stateful client.
 */

import type {
  BatchClaimRequest,
  BatchClaimResponse,
  CheckNodes,
  CheckNodesResponse,
  ClaimNodeResponse,
  NodeMetadata,
} from "@casfa/protocol";
import * as api from "../api/index.ts";
import type { TokenSelector } from "../store/token-selector.ts";
import type { FetchResult } from "../types/client.ts";
import { withAccessToken } from "./helpers.ts";

// ============================================================================
// Types
// ============================================================================

export type NodeMethods = {
  /** Get node content */
  get: (nodeKey: string) => Promise<FetchResult<Uint8Array>>;
  /** Get node content via navigation path (~0/~1/...) */
  getNavigated: (nodeKey: string, indexPath: string) => Promise<FetchResult<Uint8Array>>;
  /** Get node metadata */
  getMetadata: (nodeKey: string) => Promise<FetchResult<NodeMetadata>>;
  /** Check nodes status on the server */
  check: (params: CheckNodes) => Promise<FetchResult<CheckNodesResponse>>;
  /** Upload a node */
  put: (nodeKey: string, content: Uint8Array) => Promise<FetchResult<api.NodeUploadResult>>;
  /** Claim ownership of a node via PoP (legacy single claim) */
  claim: (nodeKey: string, pop: string) => Promise<FetchResult<ClaimNodeResponse>>;
  /** Batch claim ownership of nodes (PoP + path-based) */
  batchClaim: (params: BatchClaimRequest) => Promise<FetchResult<BatchClaimResponse>>;
};

export type NodeDeps = {
  baseUrl: string;
  realm: string;
  tokenSelector: TokenSelector;
};

// ============================================================================
// Factory
// ============================================================================

export const createNodeMethods = ({ baseUrl, realm, tokenSelector }: NodeDeps): NodeMethods => {
  const requireAccess = withAccessToken(() => tokenSelector.ensureAccessToken());

  return {
    get: (nodeKey) => requireAccess((t) => api.getNode(baseUrl, realm, t.tokenBase64, nodeKey)),

    getNavigated: (nodeKey, indexPath) =>
      requireAccess((t) => api.getNodeNavigated(baseUrl, realm, t.tokenBase64, nodeKey, indexPath)),

    getMetadata: (nodeKey) =>
      requireAccess((t) => api.getNodeMetadata(baseUrl, realm, t.tokenBase64, nodeKey)),

    check: (params) => requireAccess((t) => api.checkNodes(baseUrl, realm, t.tokenBase64, params)),

    put: (nodeKey, content) =>
      requireAccess((t) => api.putNode(baseUrl, realm, t.tokenBase64, nodeKey, content)),

    claim: (nodeKey, pop) =>
      requireAccess((t) => api.claimNode(baseUrl, realm, t.tokenBase64, nodeKey, { pop })),

    batchClaim: (params) =>
      requireAccess((t) => api.batchClaimNodes(baseUrl, realm, t.tokenBase64, params)),
  };
};
