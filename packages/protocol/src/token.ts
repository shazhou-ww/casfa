/**
 * Token management schemas
 *
 * Schemas for Delegate Token and Access Token operations.
 */

import { z } from "zod";
import { TokenTypeSchema } from "./common.ts";

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
