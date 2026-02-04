/**
 * API module exports.
 */

// Admin API
export {
  type AdminApiContext,
  type ListUsersParams,
  listUsers,
  type UpdateUserRoleParams,
  updateUserRole,
} from "./admin.ts";

// Auth API (AWP Client + Agent Token)
export {
  type AuthApiContext,
  type CompleteClientParams,
  type CreateAgentTokenParams,
  completeClient,
  createAgentToken,
  type InitClientParams,
  initClient,
  type ListAgentTokensParams,
  type ListClientsParams,
  listAgentTokens,
  listClients,
  type PollClientParams,
  pollClient,
  type RevokeAgentTokenParams,
  type RevokeClientParams,
  revokeAgentToken,
  revokeClient,
} from "./auth.ts";
// Depot API
export {
  type CommitDepotParams,
  type CreateDepotParams,
  commitDepot,
  createDepot,
  type DeleteDepotParams,
  type DepotApiContext,
  deleteDepot,
  type GetDepotParams,
  getDepot,
  type ListDepotsParams,
  listDepots,
  type UpdateDepotParams,
  updateDepot,
} from "./depots.ts";

// Info API
export { getInfo, type InfoApiContext } from "./info.ts";

// MCP API
export {
  type CallMcpParams,
  type CallToolParams,
  callMcp,
  callTool,
  listTools,
  type McpApiContext,
} from "./mcp.ts";
// Node API
export {
  type GetNodeMetadataParams,
  type GetNodeParams,
  getNode,
  getNodeMetadata,
  type NodeApiContext,
  type PrepareNodesParams,
  type PutNodeParams,
  prepareNodes,
  putNode,
  type UploadNodeParams,
  uploadNode,
} from "./nodes.ts";
// OAuth API
export {
  type BuildAuthUrlParams,
  buildAuthUrl,
  type ExchangeCodeParams,
  exchangeCode,
  getConfig,
  getMe,
  type LoginParams,
  login,
  type OAuthApiContext,
  type RefreshParams,
  refresh,
} from "./oauth.ts";
// Realm API
export {
  getRealmInfo,
  getRealmUsage,
  type RealmApiContext,
} from "./realm.ts";
// Ticket API
export {
  type CommitTicketParams,
  type CreateTicketParams,
  commitTicket,
  createTicket,
  type DeleteTicketParams,
  deleteTicket,
  type GetTicketParams,
  getTicket,
  type ListTicketsParams,
  listTickets,
  type RevokeTicketParams,
  revokeTicket,
  type TicketApiContext,
} from "./tickets.ts";
