/**
 * Node methods for the stateful client.
 */

import type {
  ClaimNodeResponse,
  NodeMetadata,
  PrepareNodes,
  PrepareNodesResponse,
} from "@casfa/protocol";
import * as api from "../api/index.ts";
import type { TokenSelector } from "../store/token-selector.ts";
import type { FetchResult } from "../types/client.ts";
import { withAccessToken } from "./helpers.ts";

// ============================================================================
// Types
// ============================================================================

export type NodeMethods = {
  /** Get node content (proof is optional for root delegates) */
  get: (nodeKey: string, proof?: string) => Promise<FetchResult<Uint8Array>>;
  /** Get node metadata (proof is optional for root delegates) */
  getMetadata: (
    nodeKey: string,
    proof?: string,
  ) => Promise<FetchResult<NodeMetadata>>;
  /** Prepare nodes for upload */
  prepare: (
    params: PrepareNodes,
  ) => Promise<FetchResult<PrepareNodesResponse>>;
  /** Upload a node */
  put: (
    nodeKey: string,
    content: Uint8Array,
  ) => Promise<FetchResult<api.NodeUploadResult>>;
  /** Claim ownership of a node via PoP */
  claim: (
    nodeKey: string,
    pop: string,
  ) => Promise<FetchResult<ClaimNodeResponse>>;
};

export type NodeDeps = {
  baseUrl: string;
  realm: string;
  tokenSelector: TokenSelector;
};

// ============================================================================
// Factory
// ============================================================================

export const createNodeMethods = ({
  baseUrl,
  realm,
  tokenSelector,
}: NodeDeps): NodeMethods => {
  const requireAccess = withAccessToken(() =>
    tokenSelector.ensureAccessToken(),
  );

  return {
    get: (nodeKey, proof?) =>
      requireAccess((t) =>
        api.getNode(baseUrl, realm, t.tokenBase64, nodeKey, proof),
      ),

    getMetadata: (nodeKey, proof?) =>
      requireAccess((t) =>
        api.getNodeMetadata(baseUrl, realm, t.tokenBase64, nodeKey, proof),
      ),

    prepare: (params) =>
      requireAccess((t) =>
        api.prepareNodes(baseUrl, realm, t.tokenBase64, params),
      ),

    put: (nodeKey, content) =>
      requireAccess((t) =>
        api.putNode(baseUrl, realm, t.tokenBase64, nodeKey, content),
      ),

    claim: (nodeKey, pop) =>
      requireAccess((t) =>
        api.claimNode(baseUrl, realm, t.tokenBase64, nodeKey, { pop }),
      ),
  };
};
