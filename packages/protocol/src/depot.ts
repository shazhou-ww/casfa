/**
 * Depot management schemas
 */

import { z } from "zod";
import { NODE_KEY_REGEX } from "./common.ts";

// ============================================================================
// Constants
// ============================================================================

/** Maximum history stack size */
export const MAX_HISTORY_LIMIT = 100;
/** Default history stack size */
export const DEFAULT_MAX_HISTORY = 20;
/** Maximum title length in characters */
export const MAX_TITLE_LENGTH = 128;

// ============================================================================
// Depot Schemas
// ============================================================================

/**
 * Schema for POST /api/realm/{realmId}/depots
 * Create a new depot
 */
export const CreateDepotSchema = z.object({
  /** Depot title (max 128 characters) */
  title: z.string().max(MAX_TITLE_LENGTH).optional(),
  /** Maximum history stack length, default 20, max 100 */
  maxHistory: z
    .number()
    .int()
    .min(1)
    .max(MAX_HISTORY_LIMIT)
    .optional()
    .default(DEFAULT_MAX_HISTORY),
});

export type CreateDepot = z.infer<typeof CreateDepotSchema>;

/**
 * Schema for PATCH /api/realm/{realmId}/depots/:depotId
 * Update depot metadata
 */
export const UpdateDepotSchema = z.object({
  /** New title (max 128 characters) */
  title: z.string().max(MAX_TITLE_LENGTH).optional(),
  /** New maximum history stack length */
  maxHistory: z.number().int().min(1).max(MAX_HISTORY_LIMIT).optional(),
});

export type UpdateDepot = z.infer<typeof UpdateDepotSchema>;

/**
 * Schema for POST /api/realm/{realmId}/depots/:depotId/commit
 * Commit new root node (pushes current root to history)
 */
export const DepotCommitSchema = z.object({
  /** New root node key (must already exist in storage) */
  root: z.string().regex(NODE_KEY_REGEX, "Invalid node key format"),
});

export type DepotCommit = z.infer<typeof DepotCommitSchema>;

// ============================================================================
// Depot Query Schemas
// ============================================================================

/**
 * Schema for GET /api/realm/{realmId}/depots query params
 */
export const ListDepotsQuerySchema = z.object({
  /** Number of results to return, default 100 */
  limit: z.coerce.number().int().min(1).max(1000).optional().default(100),
  /** Pagination cursor */
  cursor: z.string().optional(),
});

export type ListDepotsQuery = z.infer<typeof ListDepotsQuerySchema>;
