/**
 * Ticket operation schemas
 */

import { z } from "zod";
import { NODE_KEY_REGEX, TicketStatusSchema } from "./common.ts";

// ============================================================================
// Ticket Query Schemas
// ============================================================================

/**
 * Schema for GET /api/realm/{realmId}/tickets query params
 */
export const ListTicketsQuerySchema = z.object({
  /** Number of results to return, default 100, max 1000 */
  limit: z.coerce.number().int().min(1).max(1000).optional().default(100),
  /** Pagination cursor */
  cursor: z.string().optional(),
  /** Filter by status */
  status: TicketStatusSchema.optional(),
});

export type ListTicketsQuery = z.infer<typeof ListTicketsQuerySchema>;

// ============================================================================
// Ticket Operation Schemas
// ============================================================================

/**
 * Schema for POST /api/realm/{realmId}/tickets/:ticketId/commit
 * Submit task result and set output node
 */
export const TicketCommitSchema = z.object({
  /** Output node key (must already exist in storage) */
  output: z.string().regex(NODE_KEY_REGEX, "Invalid node key format"),
});

export type TicketCommit = z.infer<typeof TicketCommitSchema>;
