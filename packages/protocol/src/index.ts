/**
 * CASFA Protocol - Shared schemas and types for API contract
 *
 * @packageDocumentation
 */

// ============================================================================
// Common schemas and types
// ============================================================================

export type { NodeKind, PaginationQuery, TicketStatus, UserRole } from "./common.ts";
export {
  // ID regex patterns
  CLIENT_ID_REGEX,
  // ID schemas
  ClientIdSchema,
  DEPOT_ID_REGEX,
  DepotIdSchema,
  // Crockford Base32 encoding
  decodeCrockfordBase32,
  // Well-known keys
  EMPTY_DICT_NODE_KEY,
  encodeCrockfordBase32,
  // Node key conversion
  hashToNodeKey,
  hexToNodeKey,
  ISSUER_ID_REGEX,
  IssuerIdSchema,
  NODE_KEY_REGEX,
  NodeKeySchema,
  // Enum schemas
  NodeKindSchema,
  nodeKeyToHash,
  nodeKeyToHex,
  // Pagination
  PaginationQuerySchema,
  TICKET_ID_REGEX,
  TicketIdSchema,
  TicketStatusSchema,
  TOKEN_ID_REGEX,
  TokenIdSchema,
  USER_ID_REGEX,
  UserIdSchema,
  UserRoleSchema,
} from "./common.ts";

// ============================================================================
// Admin schemas
// ============================================================================

export type { UpdateUserRole } from "./admin.ts";
export { UpdateUserRoleSchema } from "./admin.ts";

// ============================================================================
// Auth schemas
// ============================================================================

export type {
  ClientComplete,
  ClientInit,
  CreateTicket,
  CreateToken,
  Login,
  Refresh,
  TokenExchange,
  WritableConfig,
} from "./auth.ts";
export {
  // Client Auth
  ClientCompleteSchema,
  ClientInitSchema,
  // Ticket
  CreateTicketSchema,
  // Token
  CreateTokenSchema,
  // OAuth
  LoginSchema,
  RefreshSchema,
  TokenExchangeSchema,
  WritableConfigSchema,
} from "./auth.ts";

// ============================================================================
// Ticket schemas
// ============================================================================

export type { ListTicketsQuery, TicketCommit } from "./ticket.ts";
export { ListTicketsQuerySchema, TicketCommitSchema } from "./ticket.ts";

// ============================================================================
// Depot schemas
// ============================================================================

export type { CreateDepot, DepotCommit, ListDepotsQuery, UpdateDepot } from "./depot.ts";
export {
  // Schemas
  CreateDepotSchema,
  // Constants
  DEFAULT_MAX_HISTORY,
  DepotCommitSchema,
  ListDepotsQuerySchema,
  MAX_HISTORY_LIMIT,
  MAX_TITLE_LENGTH,
  UpdateDepotSchema,
} from "./depot.ts";

// ============================================================================
// Node schemas
// ============================================================================

export type {
  DictNodeMetadata,
  FileNodeMetadata,
  NodeMetadata,
  NodeUploadResponse,
  PrepareNodes,
  PrepareNodesResponse,
  SuccessorNodeMetadata,
} from "./node.ts";
export {
  // Metadata schemas
  DictNodeMetadataSchema,
  FileNodeMetadataSchema,
  NodeMetadataSchema,
  // Upload response
  NodeUploadResponseSchema,
  // Operation schemas
  PrepareNodesResponseSchema,
  PrepareNodesSchema,
  SuccessorNodeMetadataSchema,
} from "./node.ts";

// ============================================================================
// Info schemas
// ============================================================================

export type {
  AuthType,
  DatabaseType,
  ServiceFeatures,
  ServiceInfo,
  ServiceLimits,
  StorageType,
} from "./info.ts";
export {
  AuthTypeSchema,
  DatabaseTypeSchema,
  ServiceFeaturesSchema,
  ServiceInfoSchema,
  ServiceLimitsSchema,
  StorageTypeSchema,
} from "./info.ts";
