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
  /**
   * Optimistic lock: expected current root before this commit.
   * - `undefined` → backward-compatible, skip CAS check
   * - `null`      → expect depot has no root yet (first commit)
   * - `"nod_xxx"` → expect depot root is exactly this value
   *
   * If server root ≠ expectedRoot → 409 Conflict.
   */
  expectedRoot: z.string().regex(NODE_KEY_REGEX).nullable().optional(),
});

export type DepotCommit = z.infer<typeof DepotCommitSchema>;

// ============================================================================
// Depot Query Schemas
// ============================================================================

/**
 * Schema for GET /api/realm/{realmId}/depots query params
 */
export const ListDepotsQuerySchema = z.object({
  /** Number of results to return, default 20, max 100 */
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  /** Pagination cursor */
  cursor: z.string().optional(),
});

export type ListDepotsQuery = z.infer<typeof ListDepotsQuerySchema>;

// ============================================================================
// Depot Response Schemas
// ============================================================================

/**
 * Depot list item schema
 */
export const DepotListItemSchema = z.object({
  depotId: z.string(),
  title: z.string().nullable(),
  root: z.string().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export type DepotListItem = z.infer<typeof DepotListItemSchema>;

/**
 * A single diff entry in a commit summary (max 5 per commit).
 */
export const CommitDiffEntrySchema = z.object({
  /** Change type */
  type: z.enum(["added", "removed", "modified", "moved"]),
  /** Affected path (source path for moved entries) */
  path: z.string(),
  /** Node kind */
  kind: z.enum(["file", "dir"]).nullable(),
  /** Destination path (only for moved entries) */
  pathTo: z.string().nullable(),
});

export type CommitDiffEntry = z.infer<typeof CommitDiffEntrySchema>;

/** Maximum number of diff entries stored per commit */
export const MAX_COMMIT_DIFF_ENTRIES = 5;

/**
 * Single history entry: root hash + commit timestamp + optional diff summary.
 *
 * history[0] is always the **current** version.
 * Each entry records which root it was derived from (`parentRoot`).
 */
export const HistoryEntrySchema = z.object({
  root: z.string(),
  /** The root this version was derived from (null for first commit / unknown) */
  parentRoot: z.string().nullable(),
  timestamp: z.number(),
  /** Up to 5 diff entries summarising changes from parentRoot → root */
  diff: z.array(CommitDiffEntrySchema).nullable(),
  /** Whether the diff was truncated (more than MAX_COMMIT_DIFF_ENTRIES changes) */
  diffTruncated: z.boolean(),
});

export type HistoryEntry = z.infer<typeof HistoryEntrySchema>;

/**
 * Depot detail schema (for GET /api/realm/{realmId}/depots/:depotId)
 * Includes creatorIssuerId for visibility tracking
 */
export const DepotDetailSchema = z.object({
  depotId: z.string(),
  title: z.string().nullable(),
  root: z.string().nullable(),
  maxHistory: z.number().int(),
  history: z.array(HistoryEntrySchema),
  /** The Issuer ID that created this depot (Token or User ID) */
  creatorIssuerId: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export type DepotDetail = z.infer<typeof DepotDetailSchema>;

/**
 * Create depot response schema
 */
export const CreateDepotResponseSchema = z.object({
  depotId: z.string(),
  title: z.string().nullable(),
  root: z.null(),
  maxHistory: z.number().int(),
  history: z.array(HistoryEntrySchema),
  creatorIssuerId: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export type CreateDepotResponse = z.infer<typeof CreateDepotResponseSchema>;
