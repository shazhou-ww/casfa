/**
 * Node methods for the stateful client.
 */

import type { NodeMetadata, PrepareNodes, PrepareNodesResponse } from "@casfa/protocol";
import * as api from "../api/index.ts";
import type { TokenSelector } from "../store/token-selector.ts";
import type { FetchResult } from "../types/client.ts";
import { withAccessToken } from "./helpers.ts";

// ============================================================================
// Types
// ============================================================================

export type NodeMethods = {
  /** Get node content */
  get: (nodeKey: string, indexPath: string) => Promise<FetchResult<Uint8Array>>;
  /** Get node metadata */
  getMetadata: (nodeKey: string, indexPath: string) => Promise<FetchResult<NodeMetadata>>;
  /** Prepare nodes for upload */
  prepare: (params: PrepareNodes) => Promise<FetchResult<PrepareNodesResponse>>;
  /** Upload a node */
  put: (nodeKey: string, content: Uint8Array) => Promise<FetchResult<api.NodeUploadResult>>;
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
    get: (nodeKey, indexPath) =>
      requireAccess((t) => api.getNode(baseUrl, realm, t.tokenBase64, nodeKey, indexPath)),

    getMetadata: (nodeKey, indexPath) =>
      requireAccess((t) => api.getNodeMetadata(baseUrl, realm, t.tokenBase64, nodeKey, indexPath)),

    prepare: (params) =>
      requireAccess((t) => api.prepareNodes(baseUrl, realm, t.tokenBase64, params)),

    put: (nodeKey, content) =>
      requireAccess((t) => api.putNode(baseUrl, realm, t.tokenBase64, nodeKey, content)),
  };
};
