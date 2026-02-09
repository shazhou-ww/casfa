/**
 * Delegate management schemas
 *
 * Schemas for Delegate entity CRUD operations.
 * Delegates are first-class authorization entities in the delegate tree.
 */

import { z } from "zod";

// ============================================================================
// Create Delegate Request
// ============================================================================

/**
 * Schema for creating a child delegate
 *
 * Used by: POST /api/realm/{realmId}/delegates
 * Auth: Access Token (from parent delegate)
 */
export const CreateDelegateRequestSchema = z.object({
  /** Human-readable delegate name */
  name: z.string().min(1).max(64).optional(),
  /** Can upload new nodes (must not exceed parent) */
  canUpload: z.boolean().optional().default(false),
  /** Can manage depots (must not exceed parent) */
  canManageDepot: z.boolean().optional().default(false),
  /** Delegated depot IDs (subset of parent's manageable depots) */
  delegatedDepots: z.array(z.string()).optional(),
  /** Scope: relative index paths from parent scope (e.g., [".", "0:1:2"]) */
  scope: z.array(z.string()).min(1).optional(),
  /** Token TTL in seconds (for RT+AT pair, must not exceed parent remaining TTL) */
  tokenTtlSeconds: z.number().int().positive().optional(),
  /** Expiration time for the delegate entity in seconds (optional, independent of token TTL) */
  expiresIn: z.number().int().positive().optional(),
});
export type CreateDelegateRequest = z.infer<typeof CreateDelegateRequestSchema>;

// ============================================================================
// Create Delegate Response
// ============================================================================

/**
 * Response for delegate creation
 * Returns the new delegate info + RT + AT pair
 */
export const CreateDelegateResponseSchema = z.object({
  /** New delegate details */
  delegate: z.object({
    delegateId: z.string(),
    name: z.string().optional(),
    realm: z.string(),
    parentId: z.string(),
    depth: z.number().int().min(0),
    canUpload: z.boolean(),
    canManageDepot: z.boolean(),
    delegatedDepots: z.array(z.string()).optional(),
    expiresAt: z.number().optional(),
    createdAt: z.number(),
  }),
  /** Refresh Token (base64-encoded 128-byte binary) — store securely */
  refreshToken: z.string(),
  /** Access Token (base64-encoded 128-byte binary) — use for API calls */
  accessToken: z.string(),
  /** Refresh Token ID */
  refreshTokenId: z.string(),
  /** Access Token ID */
  accessTokenId: z.string(),
  /** Access Token expiration (Unix epoch ms) */
  accessTokenExpiresAt: z.number(),
});
export type CreateDelegateResponse = z.infer<typeof CreateDelegateResponseSchema>;

// ============================================================================
// Delegate Detail
// ============================================================================

/**
 * Delegate detail schema
 */
export const DelegateDetailSchema = z.object({
  delegateId: z.string(),
  name: z.string().optional(),
  realm: z.string(),
  parentId: z.string().nullable(),
  chain: z.array(z.string()),
  depth: z.number().int().min(0),
  canUpload: z.boolean(),
  canManageDepot: z.boolean(),
  delegatedDepots: z.array(z.string()).optional(),
  scopeNodeHash: z.string().optional(),
  scopeSetNodeId: z.string().optional(),
  expiresAt: z.number().optional(),
  isRevoked: z.boolean(),
  revokedAt: z.number().optional(),
  revokedBy: z.string().optional(),
  createdAt: z.number(),
});
export type DelegateDetail = z.infer<typeof DelegateDetailSchema>;

// ============================================================================
// List Delegates
// ============================================================================

/**
 * List delegates query params
 */
export const ListDelegatesQuerySchema = z.object({
  /** Number of results to return, default 20, max 100 */
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  /** Pagination cursor */
  cursor: z.string().optional(),
  /** Include revoked delegates */
  includeRevoked: z.coerce.boolean().optional().default(false),
});
export type ListDelegatesQuery = z.infer<typeof ListDelegatesQuerySchema>;

/**
 * Delegate list item schema
 */
export const DelegateListItemSchema = z.object({
  delegateId: z.string(),
  name: z.string().optional(),
  depth: z.number().int().min(0),
  canUpload: z.boolean(),
  canManageDepot: z.boolean(),
  isRevoked: z.boolean(),
  createdAt: z.number(),
  expiresAt: z.number().optional(),
});
export type DelegateListItem = z.infer<typeof DelegateListItemSchema>;

/**
 * List delegates response schema
 */
export const ListDelegatesResponseSchema = z.object({
  delegates: z.array(DelegateListItemSchema),
  nextCursor: z.string().optional(),
});
export type ListDelegatesResponse = z.infer<typeof ListDelegatesResponseSchema>;

// ============================================================================
// Revoke Delegate
// ============================================================================

/**
 * Revoke delegate response schema
 */
export const RevokeDelegateResponseSchema = z.object({
  delegateId: z.string(),
  revokedAt: z.number(),
});
export type RevokeDelegateResponse = z.infer<typeof RevokeDelegateResponseSchema>;
