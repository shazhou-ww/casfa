/**
 * API types - re-export from casfa-protocol and define response types.
 */

// Re-export all types from casfa-protocol
export type {
  // Auth (Client)
  ClientComplete,
  ClientInit,
  // Depot
  CreateDepot,
  CreateTicket,
  CreateToken,
  DepotCommit,
  // Node
  DictNodeMetadata,
  FileNodeMetadata,
  ListDepotsQuery,
  // Ticket
  ListTicketsQuery,
  Login,
  // Common
  NodeKind,
  NodeMetadata,
  NodeUploadResponse,
  PaginationQuery,
  PrepareNodes,
  PrepareNodesResponse,
  Refresh,
  SuccessorNodeMetadata,
  TicketCommit,
  TicketStatus,
  TokenExchange,
  UpdateDepot,
  // Admin
  UpdateUserRole,
  UserRole,
  WritableConfig,
} from "@casfa/protocol";

// Legacy type aliases for backward compatibility
import type { ClientComplete, ClientInit, CreateToken } from "@casfa/protocol";
/** @deprecated Use ClientInit instead */
export type AwpAuthInit = ClientInit;
/** @deprecated Use ClientComplete instead */
export type AwpAuthComplete = ClientComplete;
/** @deprecated Use CreateToken instead */
export type CreateAgentToken = CreateToken;

// =============================================================================
// OAuth Response Types
// =============================================================================

export type CognitoConfig = {
  userPoolId: string;
  clientId: string;
  domain: string;
  region: string;
};

export type TokenResponse = {
  access_token: string;
  id_token: string;
  refresh_token?: string;
  token_type: string;
  expires_in: number;
};

export type UserInfo = {
  userId: string;
  email?: string;
  name?: string;
  role: "unauthorized" | "authorized" | "admin";
  realmId?: string;
};

// =============================================================================
// AWP Client Response Types
// =============================================================================

export type AwpAuthInitResponse = {
  clientId: string;
  authUrl: string;
  displayCode: string;
  expiresIn: number;
};

export type AwpAuthPollResponse = {
  status: "pending" | "authorized" | "expired" | "rejected";
  message?: string;
};

export type AwpClientInfo = {
  clientId: string;
  name?: string;
  createdAt: number;
  lastUsedAt?: number;
};

// =============================================================================
// Agent Token Response Types
// =============================================================================

export type AgentTokenInfo = {
  tokenId: string;
  name: string;
  createdAt: number;
  lastUsedAt?: number;
  expiresAt?: number;
};

export type CreateAgentTokenResponse = {
  tokenId: string;
  token: string; // Only returned once
  name: string;
  expiresAt?: number;
};

// =============================================================================
// Admin Response Types
// =============================================================================

export type UserListItem = {
  userId: string;
  email: string;
  role: "unauthorized" | "authorized" | "admin";
  realmId?: string;
  createdAt: number;
};

// =============================================================================
// Realm Response Types
// =============================================================================

export type RealmInfo = {
  realmId: string;
  ownerId: string;
  nodeLimit: number;
  maxNameBytes: number;
};

export type RealmUsage = {
  realmId: string;
  nodeCount: number;
  totalBytes: number;
};

// =============================================================================
// Ticket Response Types
// =============================================================================

export type TicketInfo = {
  ticketId: string;
  realmId: string;
  issuerId: string;
  scope: string[];
  writable?: {
    quota?: number;
    accept?: string[];
  };
  output: string | null;
  isRevoked: boolean;
  label?: string;
  createdAt: number;
  expiresAt: number;
};

export type TicketListItem = TicketInfo;

// =============================================================================
// Depot Response Types
// =============================================================================

export type DepotInfo = {
  depotId: string;
  realmId: string;
  title: string;
  description?: string;
  root: string;
  version: number;
  createdAt: number;
  updatedAt: number;
};

export type DepotDetail = DepotInfo & {
  history: DepotHistoryEntry[];
};

export type DepotHistoryEntry = {
  root: string;
  version: number;
  committedAt: number;
  message?: string;
};

// =============================================================================
// Node Response Types
// =============================================================================

export type PrepareNodesResult = {
  exists: string[];
  missing: string[];
};

// =============================================================================
// MCP Types
// =============================================================================

export type McpRequest = {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
};

export type McpResponse = {
  jsonrpc: "2.0";
  id: string | number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
};

// =============================================================================
// Pagination Types
// =============================================================================

export type PaginatedResponse<T> = {
  items: T[];
  nextCursor?: string;
  total?: number;
};
