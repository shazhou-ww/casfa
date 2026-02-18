/**
 * Claim API schemas
 *
 * Schemas for the node claim endpoint (Proof-of-Possession based ownership).
 *
 * Single claim: POST /api/realm/{realmId}/nodes/{key}/claim  (legacy)
 * Batch claim:  POST /api/realm/{realmId}/nodes/claim        (new)
 *
 * Auth: Access Token with canUpload
 */

import { z } from "zod";

// ============================================================================
// Single Claim (legacy — kept for backward compatibility)
// ============================================================================

/**
 * Schema for claiming ownership of a CAS node via Proof-of-Possession.
 *
 * The client computes a keyed-hash PoP from its access token bytes and the
 * node content, then sends it to prove possession of both.
 */
export const ClaimNodeRequestSchema = z.object({
  /** Proof-of-Possession string (format: "pop:XXXXXX...") */
  pop: z.string().regex(/^pop:[A-Z0-9]+$/i, "Invalid PoP format"),
});
export type ClaimNodeRequest = z.infer<typeof ClaimNodeRequestSchema>;

/**
 * Response for successful node claim (single).
 */
export const ClaimNodeResponseSchema = z.object({
  /** The node hash that was claimed */
  nodeHash: z.string(),
  /** Whether this was a new claim or already owned (idempotent) */
  alreadyOwned: z.boolean(),
  /** The delegate that now owns the node */
  delegateId: z.string(),
});
export type ClaimNodeResponse = z.infer<typeof ClaimNodeResponseSchema>;

// ============================================================================
// Batch Claim (new — POST /api/realm/{realmId}/nodes/claim)
// ============================================================================

/**
 * PoP-based claim entry: prove possession of node content + token bytes.
 */
export const PopClaimEntrySchema = z.object({
  key: z.string(),
  pop: z.string().regex(/^pop:[A-Z0-9]+$/i, "Invalid PoP format"),
});
export type PopClaimEntry = z.infer<typeof PopClaimEntrySchema>;

/**
 * Path-based claim entry: prove reachability from an authorized node via ~N
 * index path. The `from` node must pass Direct Authorization Check.
 */
export const PathClaimEntrySchema = z.object({
  key: z.string(),
  from: z.string(),
  path: z.string(),
});
export type PathClaimEntry = z.infer<typeof PathClaimEntrySchema>;

/**
 * A single claim entry — either PoP-based or path-based.
 */
export const ClaimEntrySchema = z.union([PopClaimEntrySchema, PathClaimEntrySchema]);
export type ClaimEntry = z.infer<typeof ClaimEntrySchema>;

/**
 * Batch claim request: multiple claims in one request.
 */
export const BatchClaimRequestSchema = z.object({
  claims: z.array(ClaimEntrySchema).min(1).max(100),
});
export type BatchClaimRequest = z.infer<typeof BatchClaimRequestSchema>;

/**
 * Result for a single claim in a batch.
 */
export const BatchClaimResultSchema = z.object({
  key: z.string(),
  ok: z.boolean(),
  alreadyOwned: z.boolean(),
  error: z.string().nullable(),
});
export type BatchClaimResult = z.infer<typeof BatchClaimResultSchema>;

/**
 * Batch claim response.
 */
export const BatchClaimResponseSchema = z.object({
  results: z.array(BatchClaimResultSchema),
});
export type BatchClaimResponse = z.infer<typeof BatchClaimResponseSchema>;
