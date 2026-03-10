/**
 * Depot methods for the stateful client.
 */

import type {
  CreateDepot,
  CreateDepotResponse,
  DepotCommit,
  DepotDetail,
  ListDepotsQuery,
  UpdateDepot,
} from "@casfa/protocol";
import * as api from "../api/index.ts";
import type { TokenSelector } from "../store/token-selector.ts";
import type { FetchResult } from "../types/client.ts";
import { withAccessToken } from "./helpers.ts";

// ============================================================================
// Types
// ============================================================================

export type DepotMethods = {
  /** Create a new depot */
  create: (params: CreateDepot) => Promise<FetchResult<CreateDepotResponse>>;
  /** List depots */
  list: (params?: ListDepotsQuery) => Promise<FetchResult<api.ListDepotsResponse>>;
  /** Get depot details */
  get: (depotId: string) => Promise<FetchResult<DepotDetail>>;
  /** Update depot */
  update: (depotId: string, params: UpdateDepot) => Promise<FetchResult<DepotDetail>>;
  /** Delete depot */
  delete: (depotId: string) => Promise<FetchResult<void>>;
  /** Commit new root */
  commit: (depotId: string, params: DepotCommit) => Promise<FetchResult<api.CommitDepotResponse>>;
};

export type DepotDeps = {
  baseUrl: string;
  realm: string;
  tokenSelector: TokenSelector;
};

// ============================================================================
// Factory
// ============================================================================

export const createDepotMethods = ({ baseUrl, realm, tokenSelector }: DepotDeps): DepotMethods => {
  const requireAccess = withAccessToken(() => tokenSelector.ensureAccessToken());

  return {
    create: (params) =>
      requireAccess((t) => api.createDepot(baseUrl, realm, t.tokenBase64, params)),

    list: (params) => requireAccess((t) => api.listDepots(baseUrl, realm, t.tokenBase64, params)),

    get: (depotId) => requireAccess((t) => api.getDepot(baseUrl, realm, t.tokenBase64, depotId)),

    update: (depotId, params) =>
      requireAccess((t) => api.updateDepot(baseUrl, realm, t.tokenBase64, depotId, params)),

    delete: (depotId) =>
      requireAccess((t) => api.deleteDepot(baseUrl, realm, t.tokenBase64, depotId)),

    commit: (depotId, params) =>
      requireAccess((t) => api.commitDepot(baseUrl, realm, t.tokenBase64, depotId, params)),
  };
};
