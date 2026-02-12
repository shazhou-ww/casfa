/**
 * API module exports for @casfa/client
 */

// Claim API
export { claimNode } from "./claim.ts";
// Delegate API
export {
  createDelegate,
  getDelegate,
  type ListDelegatesResponse,
  listDelegates,
  revokeDelegate,
} from "./delegates.ts";
// Depot API
export {
  type CommitDepotResponse,
  commitDepot,
  createDepot,
  deleteDepot,
  getDepot,
  type ListDepotsResponse,
  listDepots,
  updateDepot,
} from "./depots.ts";
// Filesystem API
export {
  fsCp,
  fsLs,
  fsMkdir,
  fsMv,
  fsRead,
  fsRewrite,
  fsRm,
  fsStat,
  fsWrite,
} from "./filesystem.ts";
// Info API
export { fetchServiceInfo, healthCheck } from "./info.ts";
// Node API
export {
  checkNodes,
  getNode,
  getNodeMetadata,
  type NodeUploadResult,
  putNode,
} from "./nodes.ts";
// OAuth API
export {
  type CognitoConfig,
  exchangeCode,
  getMe,
  getOAuthConfig,
  login,
  refresh,
  type TokenResponse,
  tokenResponseToStoredUserToken,
  type UserInfo,
} from "./oauth.ts";
// Client Authorization Request API
export {
  approveAuthRequest,
  createAuthRequest,
  getAuthRequest,
  pollAuthRequest,
  rejectAuthRequest,
} from "./requests.ts";
// Token management API (new 2-tier model)
export { refreshToken } from "./tokens.ts";
