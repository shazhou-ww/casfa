/**
 * Delegate management methods for the stateful client.
 */

import type {
  ClaimNodeResponse,
  CreateDelegateRequest,
  CreateDelegateResponse,
  DelegateDetail,
  ListDelegatesQuery,
  RevokeDelegateResponse,
} from "@casfa/protocol";
import * as api from "../api/index.ts";
import type { TokenSelector } from "../store/token-selector.ts";
import type { FetchResult } from "../types/client.ts";
import { withAccessToken } from "./helpers.ts";

// ============================================================================
// Types
// ============================================================================

export type DelegateMethods = {
  /** Create a child delegate */
  create: (params: CreateDelegateRequest) => Promise<FetchResult<CreateDelegateResponse>>;
  /** List child delegates */
  list: (params?: ListDelegatesQuery) => Promise<FetchResult<api.ListDelegatesResponse>>;
  /** Get delegate details */
  get: (delegateId: string) => Promise<FetchResult<DelegateDetail>>;
  /** Revoke a delegate */
  revoke: (delegateId: string) => Promise<FetchResult<RevokeDelegateResponse>>;
  /** Claim ownership of a CAS node via PoP */
  claimNode: (nodeKey: string, pop: string) => Promise<FetchResult<ClaimNodeResponse>>;
};

export type DelegateDeps = {
  baseUrl: string;
  realm: string;
  tokenSelector: TokenSelector;
};

// ============================================================================
// Factory
// ============================================================================

export const createDelegateMethods = ({
  baseUrl,
  realm,
  tokenSelector,
}: DelegateDeps): DelegateMethods => {
  const requireAccess = withAccessToken(() => tokenSelector.ensureAccessToken());

  return {
    create: (params) =>
      requireAccess((t) => api.createDelegate(baseUrl, realm, t.tokenBase64, params)),

    list: (params) =>
      requireAccess((t) => api.listDelegates(baseUrl, realm, t.tokenBase64, params)),

    get: (delegateId) =>
      requireAccess((t) => api.getDelegate(baseUrl, realm, t.tokenBase64, delegateId)),

    revoke: (delegateId) =>
      requireAccess((t) => api.revokeDelegate(baseUrl, realm, t.tokenBase64, delegateId)),

    claimNode: (nodeKey, pop) =>
      requireAccess((t) => api.claimNode(baseUrl, realm, t.tokenBase64, nodeKey, { pop })),
  };
};
