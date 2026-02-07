/**
 * Token management schemas
 *
 * Schemas for Delegate Token and Access Token operations.
 */

import { z } from "zod";
import { TokenTypeSchema } from "./common.ts";

// ============================================================================
// Create Token Schemas
// ============================================================================

/**
 * Schema for creating a new Delegate Token
 *
 * Used by: POST /api/tokens
 */
export const CreateDelegateTokenSchema = z.object({
  /** Target realm (must be user's own realm: usr_{userId}) */
  realm: z.string().min(1),
  /** Human-readable token name */
  name: z.string().min(1).max(64),
  /** Token type: delegate (can re-delegate) or access (data access only) */
  type: TokenTypeSchema,
  /** Token expiration in seconds (default: 30 days) */
  expiresIn: z.number().int().positive().optional(),
  /** Whether token can upload nodes */
  canUpload: z.boolean().optional().default(false),
  /** Whether token can manage depots */
  canManageDepot: z.boolean().optional().default(false),
  /** Scope: array of CAS URIs (e.g., ["cas://depot:MAIN", "cas://node:abc123"]) */
  scope: z.array(z.string()).min(1),
});
export type CreateDelegateToken = z.infer<typeof CreateDelegateTokenSchema>;

// ============================================================================
// Delegate Token (Re-delegation)
// ============================================================================

/**
 * Schema for token delegation (re-delegation)
 *
 * Used by: POST /api/tokens/delegate
 *
 * When delegating, scope uses relative index paths instead of CAS URIs:
 * - "." means inherit all parent scope roots
 * - "0:1:2" means navigate from parent scope root 0, child 1, child 2
 */
export const DelegateTokenSchema = z.object({
  /** Token type for the new token */
  type: TokenTypeSchema,
  /** Expiration in seconds (must not exceed parent token's remaining TTL) */
  expiresIn: z.number().int().positive().optional(),
  /** Upload permission (must not exceed parent) */
  canUpload: z.boolean().optional(),
  /** Depot management permission (must not exceed parent) */
  canManageDepot: z.boolean().optional(),
  /** Relative scope paths (must be subset of parent scope) */
  scope: z.array(z.string()).min(1),
  /** Optional name for the delegated token */
  name: z.string().min(1).max(64).optional(),
});
export type DelegateToken = z.infer<typeof DelegateTokenSchema>;

// ============================================================================
// Token Query Schemas
// ============================================================================

/**
 * Schema for GET /api/realm/{realmId}/tokens query params
 */
export const ListTokensQuerySchema = z.object({
  /** Number of results to return, default 20, max 100 */
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  /** Pagination cursor */
  cursor: z.string().optional(),
  /** Filter by token type */
  type: TokenTypeSchema.optional(),
  /** Include revoked tokens */
  includeRevoked: z.coerce.boolean().optional().default(false),
});

export type ListTokensQuery = z.infer<typeof ListTokensQuerySchema>;

// ============================================================================
// Token Response Schemas
// ============================================================================

/**
 * Token list item schema
 */
export const TokenListItemSchema = z.object({
  tokenId: z.string(),
  name: z.string().nullable(),
  type: TokenTypeSchema,
  createdAt: z.number(),
  expiresAt: z.number(),
  revokedAt: z.number().optional(),
});

export type TokenListItem = z.infer<typeof TokenListItemSchema>;

/**
 * Token detail schema (for GET /api/realm/{realmId}/tokens/:tokenId)
 */
export const TokenDetailSchema = z.object({
  tokenId: z.string(),
  name: z.string().nullable(),
  type: TokenTypeSchema,
  /** Depth level in the delegation tree (0 = root token from user) */
  depth: z.number().int().min(0),
  /** Parent issuer ID (user or token that created this token) */
  issuerId: z.string(),
  /** Permission to upload nodes */
  canUpload: z.boolean(),
  /** Permission to create and manage depots */
  canManageDepot: z.boolean(),
  /** Scope pattern for node access restriction */
  scope: z.string().nullable(),
  createdAt: z.number(),
  expiresAt: z.number(),
  revokedAt: z.number().optional(),
});

export type TokenDetail = z.infer<typeof TokenDetailSchema>;

/**
 * Create token response schema
 * Note: tokenBase64 is only returned once at creation time
 */
export const CreateTokenResponseSchema = z.object({
  tokenId: z.string(),
  name: z.string().nullable(),
  type: TokenTypeSchema,
  depth: z.number().int().min(0),
  issuerId: z.string(),
  canUpload: z.boolean(),
  canManageDepot: z.boolean(),
  scope: z.string().nullable(),
  /** Delegate Token Base64 - only returned once at creation */
  tokenBase64: z.string(),
  createdAt: z.number(),
  expiresAt: z.number(),
});

export type CreateTokenResponse = z.infer<typeof CreateTokenResponseSchema>;

/**
 * Revoke token response schema
 */
export const RevokeTokenResponseSchema = z.object({
  tokenId: z.string(),
  revokedAt: z.number(),
});

export type RevokeTokenResponse = z.infer<typeof RevokeTokenResponseSchema>;
