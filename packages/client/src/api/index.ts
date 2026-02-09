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
// Info API
export { fetchServiceInfo, healthCheck } from "./info.ts";
// Node API
export {
  getNode,
  getNodeMetadata,
  type NodeUploadResult,
  prepareNodes,
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
// Ticket API
export {
  createTicket,
  getTicket,
  type ListTicketsResponse,
  listTickets,
  type SubmitTicketResponse,
  submitTicket,
} from "./tickets.ts";
// Token management API (new 2-tier model)
export { createRootToken, refreshToken } from "./tokens.ts";
