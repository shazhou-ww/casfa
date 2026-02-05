/**
 * Client Authorization Request schemas
 *
 * Schemas for the client authorization flow used by untrusted clients
 * to request Access Token through human approval.
 */

import { z } from "zod";
import { AuthRequestStatusSchema, TokenTypeSchema } from "./common.ts";

// ============================================================================
// Constants
// ============================================================================

/** Maximum request name length */
export const MAX_REQUEST_NAME_LENGTH = 128;

// ============================================================================
// Client Request Schemas
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
