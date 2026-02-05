/**
 * Token Schemas
 *
 * Zod schemas for Delegate Token API.
 * Based on docs/delegate-token-refactor/impl/02-router-refactor.md
 */

import { z } from "zod";

// ============================================================================
// Token Type
// ============================================================================

/**
 * Token type enum schema
 */
export const TokenTypeSchema = z.enum(["delegate", "access"]);
export type TokenType = z.infer<typeof TokenTypeSchema>;

// ============================================================================
// Create Delegate Token
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
// Token Query Params
// ============================================================================

/**
 * Schema for listing tokens query parameters
 */
export const ListTokensQuerySchema = z.object({
  limit: z
    .string()
    .optional()
    .transform((v) => (v ? parseInt(v, 10) : 20))
    .pipe(z.number().int().min(1).max(100)),
  cursor: z.string().optional(),
  includeRevoked: z
    .string()
    .optional()
    .transform((v) => v === "true"),
});
export type ListTokensQuery = z.infer<typeof ListTokensQuerySchema>;

// ============================================================================
// Token ID Validation
// ============================================================================

/**
 * Token ID regex pattern
 */
export const DELEGATE_TOKEN_ID_REGEX = /^dlt1_[0-9A-HJ-KM-NP-TV-Z]{26}$/i;

/**
 * Token ID schema
 */
export const DelegateTokenIdSchema = z.string().regex(DELEGATE_TOKEN_ID_REGEX, {
  message: "Invalid token ID format. Expected: dlt1_{26 chars}",
});
