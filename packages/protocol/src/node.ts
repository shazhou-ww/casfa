/**
 * Node operation schemas
 */

import { z } from "zod";
import { NODE_KEY_REGEX, NodeKindSchema } from "./common.ts";

// ============================================================================
// Node Operation Schemas
// ============================================================================

/**
 * Schema for POST /api/realm/{realmId}/nodes/check
 * Check server-side status of a batch of nodes.
 *
 * Note: This operation has side effects - existing nodes are "touched"
 * to update their lastAccessedAt timestamp, preventing GC.
 */
export const CheckNodesSchema = z.object({
  /** Array of node keys to check (1-1000) */
  keys: z.array(z.string().regex(NODE_KEY_REGEX, "Invalid node key format")).min(1).max(1000),
});

export type CheckNodes = z.infer<typeof CheckNodesSchema>;

/**
 * Response schema for nodes/check
 *
 * Three-way classification:
 * - missing: node does not exist in CAS
 * - owned: node exists and is owned by the current delegate chain
 * - unowned: node exists but not owned by the current delegate chain
 */
export const CheckNodesResponseSchema = z.object({
  /** Node keys that do not exist in CAS */
  missing: z.array(z.string()),
  /** Node keys that exist and are owned by current delegate chain */
  owned: z.array(z.string()),
  /** Node keys that exist but are NOT owned by current delegate chain */
  unowned: z.array(z.string()),
});

export type CheckNodesResponse = z.infer<typeof CheckNodesResponseSchema>;

// ============================================================================
// Node Metadata Schemas
// ============================================================================

/**
 * Base node metadata fields
 */
const BaseNodeMetadataSchema = z.object({
  key: z.string(),
  kind: NodeKindSchema,
  payloadSize: z.number().int().nonnegative(),
});

/**
 * Dict node (d-node) metadata
 */
export const DictNodeMetadataSchema = BaseNodeMetadataSchema.extend({
  kind: z.literal("dict"),
  children: z.record(z.string(), z.string()),
});

export type DictNodeMetadata = z.infer<typeof DictNodeMetadataSchema>;

/**
 * File node (f-node) metadata
 */
export const FileNodeMetadataSchema = BaseNodeMetadataSchema.extend({
  kind: z.literal("file"),
  contentType: z.string(),
  successor: z.string().optional(),
});

export type FileNodeMetadata = z.infer<typeof FileNodeMetadataSchema>;

/**
 * Successor node (s-node) metadata
 */
export const SuccessorNodeMetadataSchema = BaseNodeMetadataSchema.extend({
  kind: z.literal("successor"),
  successor: z.string().optional(),
});

export type SuccessorNodeMetadata = z.infer<typeof SuccessorNodeMetadataSchema>;

/**
 * Union of all node metadata types
 */
export const NodeMetadataSchema = z.discriminatedUnion("kind", [
  DictNodeMetadataSchema,
  FileNodeMetadataSchema,
  SuccessorNodeMetadataSchema,
]);

export type NodeMetadata = z.infer<typeof NodeMetadataSchema>;

// ============================================================================
// Node Upload Response Schema
// ============================================================================

/**
 * Response schema for PUT /api/realm/{realmId}/nodes/:key
 */
export const NodeUploadResponseSchema = z.object({
  key: z.string(),
  kind: NodeKindSchema,
  payloadSize: z.number().int().nonnegative(),
});

export type NodeUploadResponse = z.infer<typeof NodeUploadResponseSchema>;
