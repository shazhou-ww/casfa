/**
 * Claim API schemas
 *
 * Schemas for the node claim endpoint (Proof-of-Possession based ownership).
 *
 * Used by: POST /api/realm/{realmId}/nodes/{key}/claim
 * Auth: Access Token
 */

import { z } from "zod";

// ============================================================================
// Claim Node Request
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

// ============================================================================
// Claim Node Response
// ============================================================================

/**
 * Response for successful node claim.
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
