/**
 * Client exports.
 *
 * New stateless, type-safe client architecture.
 */

// Main entry point
export { createCasfaClient } from "./anonymous.ts";
export { createDelegateClient, type DelegateClientConfig } from "./delegate.ts";
// Fetcher (for advanced usage)
export {
  createStatelessFetcher,
  type FetchResult,
  type RequestOptions,
  type StatelessFetcher,
  type StatelessFetcherConfig,
} from "./fetcher.ts";
// Individual client factories (for advanced usage)
export { createTicketClient, type TicketClientConfig } from "./ticket.ts";

// Types
export type {
  // API parameter types
  BuildAuthUrlParams,
  CallMcpParams,
  CallToolParams,
  // Anonymous client (entry point)
  CasfaAnonymousClient,
  // Base client
  CasfaBaseClient,
  // Delegate client (for agents)
  CasfaDelegateClient,
  CasfaDelegateRealmView,
  // Ticket client
  CasfaTicketClient,
  // User client
  CasfaUserClient,
  CasfaUserRealmView,
  // Config
  ClientConfig,
  CommitDepotParams,
  CommitTicketParams,
  CompleteClientParams,
  CreateAgentTokenParams,
  CreateDepotParams,
  CreateTicketParams,
  ExchangeCodeParams,
  GetDepotParams,
  InitClientParams,
  ListAgentTokensParams,
  ListClientsParams,
  ListDepotsParams,
  ListTicketsParams,
  ListUsersParams,
  LoginParams,
  PollClientParams,
  PrepareNodesParams,
  PutNodeParams,
  RefreshParams,
  RevokeAgentTokenParams,
  RevokeClientParams,
  UpdateDepotParams,
  UpdateUserRoleParams,
} from "./types.ts";
export { createUserClient, type UserClientConfig } from "./user.ts";
