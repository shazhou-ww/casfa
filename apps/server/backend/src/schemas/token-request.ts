/**
 * Token Request Schemas
 *
 * Zod schemas for client authorization request flow.
 * Based on docs/delegate-token-refactor/06-client-auth-flow.md
 */

import { z } from "zod";
import { TokenTypeSchema } from "./token.ts";

// ============================================================================
// Create Token Request
// ============================================================================

/**
 * Schema for creating an authorization request (client-side)
 *
 * Used by: POST /api/tokens/requests
 *
 * This is the first step of the client authorization flow.
 * Client generates a clientSecret locally and sends the hash.
 */
export const CreateTokenRequestSchema = z.object({
  /** Human-readable client name (shown to user for approval) */
  clientName: z.string().min(1).max(64),
  /** Optional description of what the client does */
  description: z.string().max(256).optional(),
  /** Hash of client-generated secret (SHA-256 hex) */
  clientSecretHash: z.string().length(64).regex(/^[0-9a-f]+$/i),
});
export type CreateTokenRequest = z.infer<typeof CreateTokenRequestSchema>;

// ============================================================================
// Approve Token Request
// ============================================================================

/**
 * Schema for approving an authorization request (user-side)
 *
 * Used by: POST /api/tokens/requests/:requestId/approve
 *
 * User specifies what permissions to grant to the client.
 */
export const ApproveTokenRequestSchema = z.object({
  /** Target realm (must be user's own realm) */
  realm: z.string().min(1),
  /** Token type to issue */
  type: TokenTypeSchema,
  /** Human-readable name for the token */
  name: z.string().min(1).max(64),
  /** Token expiration in seconds (default: 30 days) */
  expiresIn: z.number().int().positive().optional(),
  /** Upload permission */
  canUpload: z.boolean().optional().default(false),
  /** Depot management permission */
  canManageDepot: z.boolean().optional().default(false),
  /** Scope: array of CAS URIs */
  scope: z.array(z.string()).min(1),
});
export type ApproveTokenRequest = z.infer<typeof ApproveTokenRequestSchema>;

// ============================================================================
// Request ID Validation
// ============================================================================

/**
 * Request ID regex pattern
 */
export const TOKEN_REQUEST_ID_REGEX = /^req_[A-Za-z0-9_-]{22}$/;

/**
 * Request ID schema
 */
export const TokenRequestIdSchema = z.string().regex(TOKEN_REQUEST_ID_REGEX, {
  message: "Invalid request ID format",
});
