/**
 * Client Authorization Request schemas
 *
 * Schemas for the client authorization flow used by untrusted clients
 * to request Access Token through human approval.
 */

import { z } from "zod";
import { AuthRequestStatusSchema, REQUEST_ID_REGEX, TokenTypeSchema } from "./common.ts";

// ============================================================================
// Constants
// ============================================================================

/** Maximum request name length */
export const MAX_REQUEST_NAME_LENGTH = 128;

// ============================================================================
// Token Request Schemas (with client secret)
// Based on docs/delegate-token-refactor/06-client-auth-flow.md
// ============================================================================

/**
 * Schema for creating an authorization request (client-side)
 *
 * Used by: POST /api/tokens/requests
 *
 * This is the first step of the client authorization flow.
 * Client generates a clientSecret locally and sends the hash.
 */
export const CreateTokenRequestSchema = z.object({
  /** Human-readable client name (shown to user for approval) */
  clientName: z.string().min(1).max(64),
  /** Optional description of what the client does */
  description: z.string().max(256).optional(),
  /** Hash of client-generated secret (SHA-256 hex) */
  clientSecretHash: z.string().length(64).regex(/^[0-9a-f]+$/i),
});
export type CreateTokenRequest = z.infer<typeof CreateTokenRequestSchema>;

/**
 * Schema for approving an authorization request (user-side)
 *
 * Used by: POST /api/tokens/requests/:requestId/approve
 *
 * User specifies what permissions to grant to the client.
 */
export const ApproveTokenRequestSchema = z.object({
  /** Target realm (must be user's own realm) */
  realm: z.string().min(1),
  /** Token type to issue */
  type: TokenTypeSchema,
  /** Human-readable name for the token */
  name: z.string().min(1).max(64),
  /** Token expiration in seconds (default: 30 days) */
  expiresIn: z.number().int().positive().optional(),
  /** Upload permission */
  canUpload: z.boolean().optional().default(false),
  /** Depot management permission */
  canManageDepot: z.boolean().optional().default(false),
  /** Scope: array of CAS URIs */
  scope: z.array(z.string()).min(1),
});
export type ApproveTokenRequest = z.infer<typeof ApproveTokenRequestSchema>;

/**
 * Token Request ID schema
 */
export const TokenRequestIdSchema = z.string().regex(REQUEST_ID_REGEX, {
  message: "Invalid request ID format",
});

// ============================================================================
// Client Request Schemas (legacy/general flow)
// ============================================================================

/**
 * Schema for POST /api/auth/request
 * Create a new authorization request
 */
export const CreateAuthRequestSchema = z.object({
  /** Target realm ID */
  realm: z.string(),
  /** Display name for the request (shown in approval UI) */
  name: z.string().max(MAX_REQUEST_NAME_LENGTH).optional(),
  /** Requested token type (default: "access") */
  type: TokenTypeSchema.optional().default("access"),
  /** Requested token TTL in seconds */
  expiresIn: z.number().int().positive().optional(),
  /** Request upload permission */
  canUpload: z.boolean().optional().default(false),
  /** Request depot management permission (only for delegate tokens) */
  canManageDepot: z.boolean().optional().default(false),
  /** Requested scope pattern */
  scope: z.string().optional(),
});

export type CreateAuthRequest = z.infer<typeof CreateAuthRequestSchema>;

/**
 * Response for POST /api/auth/request
 */
export const CreateAuthRequestResponseSchema = z.object({
  /** Unique request ID (req_{base64url}) */
  requestId: z.string(),
  /** Authorization URL to open in browser for human approval */
  authUrl: z.string().url(),
  /** Request expiration time */
  expiresAt: z.number(),
});

export type CreateAuthRequestResponse = z.infer<typeof CreateAuthRequestResponseSchema>;

/**
 * Schema for GET /api/auth/request/:requestId/poll
 * Poll for authorization request status
 */
export const PollRequestResponseSchema = z.object({
  /** Request ID */
  requestId: z.string(),
  /** Current status */
  status: AuthRequestStatusSchema,
  /** Access Token Base64 (only present when status is "approved") */
  tokenBase64: z.string().optional(),
  /** Token expiration time (only present when status is "approved") */
  expiresAt: z.number().optional(),
  /** Denial reason (only present when status is "denied") */
  reason: z.string().optional(),
});

export type PollRequestResponse = z.infer<typeof PollRequestResponseSchema>;

// ============================================================================
// Approval Schemas (used by human approver)
// ============================================================================

/**
 * Schema for POST /api/auth/request/:requestId/approve
 * Approve a pending authorization request
 */
export const ApproveRequestSchema = z.object({
  /** Override token type (optional, defaults to request's type) */
  type: TokenTypeSchema.optional(),
  /** Override token TTL in seconds */
  expiresIn: z.number().int().positive().optional(),
  /** Override upload permission */
  canUpload: z.boolean().optional(),
  /** Override depot management permission */
  canManageDepot: z.boolean().optional(),
  /** Override scope pattern */
  scope: z.string().optional(),
});

export type ApproveRequest = z.infer<typeof ApproveRequestSchema>;

/**
 * Response for POST /api/auth/request/:requestId/approve
 */
export const ApproveRequestResponseSchema = z.object({
  /** Request ID */
  requestId: z.string(),
  /** Status will be "approved" */
  status: z.literal("approved"),
  /** Issued token ID */
  tokenId: z.string(),
});

export type ApproveRequestResponse = z.infer<typeof ApproveRequestResponseSchema>;

/**
 * Schema for POST /api/auth/request/:requestId/deny
 * Deny a pending authorization request
 */
export const DenyRequestSchema = z.object({
  /** Optional reason for denial */
  reason: z.string().max(256).optional(),
});

export type DenyRequest = z.infer<typeof DenyRequestSchema>;

/**
 * Response for POST /api/auth/request/:requestId/deny
 */
export const DenyRequestResponseSchema = z.object({
  /** Request ID */
  requestId: z.string(),
  /** Status will be "denied" */
  status: z.literal("denied"),
});

export type DenyRequestResponse = z.infer<typeof DenyRequestResponseSchema>;

// ============================================================================
// Request List Schemas (for admin/management UI)
// ============================================================================

/**
 * Schema for GET /api/auth/requests query params
 * List pending authorization requests
 */
export const ListRequestsQuerySchema = z.object({
  /** Number of results to return, default 20, max 100 */
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  /** Pagination cursor */
  cursor: z.string().optional(),
  /** Filter by status */
  status: AuthRequestStatusSchema.optional(),
});

export type ListRequestsQuery = z.infer<typeof ListRequestsQuerySchema>;

/**
 * Request list item schema
 */
export const RequestListItemSchema = z.object({
  requestId: z.string(),
  realm: z.string(),
  name: z.string().nullable(),
  type: TokenTypeSchema,
  status: AuthRequestStatusSchema,
  createdAt: z.number(),
  expiresAt: z.number(),
});

export type RequestListItem = z.infer<typeof RequestListItemSchema>;
