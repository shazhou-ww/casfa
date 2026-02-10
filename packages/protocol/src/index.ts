/**
 * CASFA Protocol - Shared schemas and types for API contract
 *
 * @packageDocumentation
 */

// ============================================================================
// Common schemas and types
// ============================================================================

export type {
  AuthRequestStatus,
  NodeKind,
  PaginationQuery,
  TokenType,
  UserRole,
} from "./common.ts";
export {
  // Enum schemas
  AuthRequestStatusSchema,
  // ID regex patterns
  DELEGATE_ID_REGEX,
  DELEGATE_TOKEN_ID_REGEX,
  DEPOT_ID_REGEX,
  // ID schemas
  DelegateIdSchema,
  DelegateTokenIdSchema,
  DepotIdSchema,
  // Crockford Base32 encoding
  decodeCrockfordBase32,
  // Well-known keys
  EMPTY_DICT_NODE_KEY,
  encodeCrockfordBase32,
  // Node key conversion (new names)
  hashToNodeKey,
  ISSUER_ID_REGEX,
  IssuerIdSchema,
  NODE_KEY_PREFIX,
  NODE_KEY_REGEX,
  NodeKeySchema,
  NodeKindSchema,
  nodeKeyToHash,
  nodeKeyToStorageKey,
  PaginationQuerySchema,
  REQUEST_ID_REGEX,
  RequestIdSchema,
  storageKeyToNodeKey,
  TokenTypeSchema,
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
  CreateToken,
  Login,
  Refresh,
  Register,
  TokenExchange,
} from "./auth.ts";
export {
  // Client Auth
  ClientCompleteSchema,
  ClientInitSchema,
  // Token
  CreateTokenSchema,
  // OAuth
  LoginSchema,
  RefreshSchema,
  RegisterSchema,
  TokenExchangeSchema,
} from "./auth.ts";

// ============================================================================
// Token schemas
// ============================================================================

export type {
  CreateDelegateToken,
  CreateTokenResponse,
  DelegateToken,
  ListTokensQuery,
  RefreshTokenRequest,
  RefreshTokenResponse,
  RevokeTokenResponse,
  RootTokenRequest,
  RootTokenResponse,
  TokenDetail,
  TokenListItem,
} from "./token.ts";
export {
  CreateDelegateTokenSchema,
  CreateTokenResponseSchema,
  DelegateTokenSchema,
  ListTokensQuerySchema,
  RefreshTokenRequestSchema,
  RefreshTokenResponseSchema,
  RevokeTokenResponseSchema,
  RootTokenRequestSchema,
  RootTokenResponseSchema,
  TokenDetailSchema,
  TokenListItemSchema,
} from "./token.ts";

// ============================================================================
// Delegate schemas
// ============================================================================

export type {
  CreateDelegateRequest,
  CreateDelegateResponse,
  DelegateDetail,
  DelegateListItem,
  ListDelegatesQuery,
  ListDelegatesResponse,
  RevokeDelegateResponse,
} from "./delegate.ts";
export {
  CreateDelegateRequestSchema,
  CreateDelegateResponseSchema,
  DelegateDetailSchema,
  DelegateListItemSchema,
  ListDelegatesQuerySchema,
  ListDelegatesResponseSchema,
  RevokeDelegateResponseSchema,
} from "./delegate.ts";

// ============================================================================
// Claim schemas
// ============================================================================

export type { ClaimNodeRequest, ClaimNodeResponse } from "./claim.ts";
export { ClaimNodeRequestSchema, ClaimNodeResponseSchema } from "./claim.ts";

// ============================================================================
// Depot schemas
// ============================================================================

export type {
  CreateDepot,
  CreateDepotResponse,
  DepotCommit,
  DepotDetail,
  DepotListItem,
  ListDepotsQuery,
  UpdateDepot,
} from "./depot.ts";
export {
  CreateDepotResponseSchema,
  // Schemas
  CreateDepotSchema,
  // Constants
  DEFAULT_MAX_HISTORY,
  DepotCommitSchema,
  DepotDetailSchema,
  // Response schemas
  DepotListItemSchema,
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

// ============================================================================
// Authorization Request schemas
// ============================================================================

export type {
  ApproveRequest,
  ApproveRequestResponse,
  ApproveTokenRequest,
  CreateAuthRequest,
  CreateAuthRequestResponse,
  CreateTokenRequest,
  DenyRequest,
  DenyRequestResponse,
  ListRequestsQuery,
  PollRequestResponse,
  RequestListItem,
} from "./request.ts";
export {
  ApproveRequestResponseSchema,
  ApproveRequestSchema,
  ApproveTokenRequestSchema,
  CreateAuthRequestResponseSchema,
  CreateAuthRequestSchema,
  CreateTokenRequestSchema,
  DenyRequestResponseSchema,
  DenyRequestSchema,
  ListRequestsQuerySchema,
  MAX_REQUEST_NAME_LENGTH,
  PollRequestResponseSchema,
  RequestListItemSchema,
  TokenRequestIdSchema,
} from "./request.ts";

// ============================================================================
// Error schemas and codes
// ============================================================================

export type { ErrorCode, ErrorResponse } from "./errors.ts";
export {
  // Error codes
  ACCESS_TOKEN_REQUIRED,
  DELEGATE_TOKEN_REQUIRED,
  DEPOT_MANAGEMENT_NOT_ALLOWED,
  DEPOT_NOT_FOUND,
  // Schemas
  ErrorCodeSchema,
  ErrorResponseSchema,
  FORBIDDEN,
  INDEX_PATH_REQUIRED,
  INTERNAL_ERROR,
  INVALID_BOUND_TOKEN,
  INVALID_ID_FORMAT,
  INVALID_NODE_KEY,
  MAX_DEPTH_EXCEEDED,
  NODE_NOT_FOUND,
  RATE_LIMIT_EXCEEDED,
  REALM_MISMATCH,
  REALM_NOT_FOUND,
  REQUEST_DENIED,
  REQUEST_EXPIRED,
  REQUEST_NOT_FOUND,
  REQUEST_NOT_PENDING,
  SCOPE_MISMATCH,
  TOKEN_ALREADY_BOUND,
  TOKEN_EXPIRED,
  TOKEN_INVALID,
  TOKEN_NOT_FOUND,
  TOKEN_REVOKED,
  UNAUTHORIZED,
  UPLOAD_NOT_ALLOWED,
  VALIDATION_ERROR,
} from "./errors.ts";

// ============================================================================
// Filesystem schemas
// ============================================================================

export type {
  FsCpRequest,
  FsCpResponse,
  FsLsChild,
  FsLsQuery,
  FsLsResponse,
  FsMkdirRequest,
  FsMkdirResponse,
  FsMvRequest,
  FsMvResponse,
  FsNodeType,
  FsPathQuery,
  FsRewriteEntry,
  FsRewriteRequest,
  FsRewriteResponse,
  FsRmRequest,
  FsRmResponse,
  FsStatResponse,
  FsWriteResponse,
} from "./filesystem.ts";
export {
  // Error codes
  FS_CANNOT_MOVE_ROOT,
  FS_CANNOT_REMOVE_ROOT,
  FS_COLLECTION_FULL,
  FS_CONTENT_LENGTH_MISMATCH,
  FS_EMPTY_REWRITE,
  FS_EXISTS_AS_FILE,
  FS_FILE_TOO_LARGE,
  FS_INDEX_OUT_OF_BOUNDS,
  FS_INVALID_PATH,
  FS_INVALID_ROOT,
  FS_LINK_NOT_AUTHORIZED,
  // Constants
  FS_MAX_COLLECTION_CHILDREN,
  FS_MAX_NAME_BYTES,
  FS_MAX_NODE_SIZE,
  FS_MAX_REWRITE_ENTRIES,
  FS_MOVE_INTO_SELF,
  FS_NAME_TOO_LONG,
  FS_NODE_NOT_IN_SCOPE,
  FS_NOT_A_DIRECTORY,
  FS_NOT_A_FILE,
  FS_PATH_NOT_FOUND,
  FS_TARGET_EXISTS,
  FS_TOO_MANY_ENTRIES,
  // Schemas
  FsCpRequestSchema,
  FsCpResponseSchema,
  FsLsChildSchema,
  FsLsQuerySchema,
  FsLsResponseSchema,
  FsMkdirRequestSchema,
  FsMkdirResponseSchema,
  FsMvRequestSchema,
  FsMvResponseSchema,
  FsNodeTypeSchema,
  FsPathQuerySchema,
  FsRewriteEntrySchema,
  FsRewriteRequestSchema,
  FsRewriteResponseSchema,
  FsRmRequestSchema,
  FsRmResponseSchema,
  FsStatResponseSchema,
  FsWriteResponseSchema,
} from "./filesystem.ts";
