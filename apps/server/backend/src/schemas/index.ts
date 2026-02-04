/**
 * Zod schemas exports
 *
 * Re-exports from @casfa/protocol for shared API contract,
 * plus local legacy schemas for backward compatibility.
 */

// ============================================================================
// Re-export all from casfa-protocol
// ============================================================================

export type {
  // Auth types
  ClientComplete,
  ClientInit,
  // Depot types
  CreateDepot,
  CreateTicket,
  CreateToken,
  DepotCommit,
  // Node types
  DictNodeMetadata,
  FileNodeMetadata,
  ListDepotsQuery,
  // Ticket types
  ListTicketsQuery,
  Login,
  // Common types
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
  // Admin types
  UpdateUserRole,
  UserRole,
  WritableConfig,
} from "@casfa/protocol";
export {
  // ID regex patterns
  CLIENT_ID_REGEX,
  // Auth schemas
  ClientCompleteSchema,
  // ID schemas
  ClientIdSchema,
  ClientInitSchema,
  // Depot schemas
  CreateDepotSchema,
  CreateTicketSchema,
  CreateTokenSchema,
  DEFAULT_MAX_HISTORY,
  DEPOT_ID_REGEX,
  DepotCommitSchema,
  DepotIdSchema,
  // Node schemas
  DictNodeMetadataSchema,
  FileNodeMetadataSchema,
  ISSUER_ID_REGEX,
  IssuerIdSchema,
  ListDepotsQuerySchema,
  // Ticket schemas
  ListTicketsQuerySchema,
  LoginSchema,
  MAX_HISTORY_LIMIT,
  MAX_TITLE_LENGTH,
  NODE_KEY_REGEX,
  NodeKeySchema,
  // Enum schemas
  NodeKindSchema,
  NodeMetadataSchema,
  NodeUploadResponseSchema,
  // Pagination
  PaginationQuerySchema,
  PrepareNodesResponseSchema,
  PrepareNodesSchema,
  RefreshSchema,
  SuccessorNodeMetadataSchema,
  TICKET_ID_REGEX,
  TicketCommitSchema,
  TicketIdSchema,
  TicketStatusSchema,
  TOKEN_ID_REGEX,
  TokenExchangeSchema,
  TokenIdSchema,
  UpdateDepotSchema,
  // Admin schemas
  UpdateUserRoleSchema,
  USER_ID_REGEX,
  UserIdSchema,
  UserRoleSchema,
  WritableConfigSchema,
} from "@casfa/protocol";

// ============================================================================
// Legacy schemas (for backward compatibility)
// ============================================================================

import { UpdateUserRoleSchema } from "@casfa/protocol";

/**
 * @deprecated Use UpdateUserRoleSchema instead
 */
export const AuthorizeUserSchema = UpdateUserRoleSchema;
