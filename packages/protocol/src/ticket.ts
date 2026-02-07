/**
 * Ticket operation schemas
 */

import { z } from "zod";
import { NODE_KEY_REGEX, TicketStatusSchema } from "./common.ts";

// ============================================================================
// Ticket Create Schemas
// ============================================================================

/**
 * Schema for creating a new Ticket
 *
 * Used by: POST /api/realm/:realmId/tickets
 *
 * The accessTokenId is derived server-side from the authenticated Access Token.
 * The client only needs to provide the ticket title.
 */
export const CreateTicketSchema = z.object({
  /** Human-readable title for the ticket */
  title: z.string().min(1).max(256),
});
export type CreateTicket = z.infer<typeof CreateTicketSchema>;

// ============================================================================
// Ticket Query Schemas
// ============================================================================

/**
 * Schema for GET /api/realm/{realmId}/tickets query params
 */
export const ListTicketsQuerySchema = z.object({
  /** Number of results to return, default 20, max 100 */
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
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
 * Schema for POST /api/realm/{realmId}/tickets/:ticketId/submit
 * Submit task result and set root node
 *
 * Note: Submitting a ticket automatically revokes the associated Access Token
 */
export const TicketSubmitSchema = z.object({
  /** Root node key (must already exist in storage) */
  root: z.string().regex(NODE_KEY_REGEX, "Invalid node key format"),
});

export type TicketSubmit = z.infer<typeof TicketSubmitSchema>;

/**
 * @deprecated Use TicketSubmitSchema instead
 * Old schema for POST /api/realm/{realmId}/tickets/:ticketId/commit
 */
export const TicketCommitSchema = z.object({
  /** Output node key (must already exist in storage) */
  output: z.string().regex(NODE_KEY_REGEX, "Invalid node key format"),
});

export type TicketCommit = z.infer<typeof TicketCommitSchema>;

// ============================================================================
// Ticket Response Schemas
// ============================================================================

/**
 * Ticket list item schema
 */
export const TicketListItemSchema = z.object({
  ticketId: z.string(),
  title: z.string(),
  status: TicketStatusSchema,
  createdAt: z.number(),
});

export type TicketListItem = z.infer<typeof TicketListItemSchema>;

/**
 * Ticket detail schema (for GET /api/realm/{realmId}/tickets/:ticketId)
 */
export const TicketDetailSchema = z.object({
  ticketId: z.string(),
  title: z.string(),
  status: TicketStatusSchema,
  root: z.string().nullable(),
  /** Bound Access Token ID (for Tool use) */
  accessTokenId: z.string(),
  /** Creator's issuer ID (for Issuer Chain visibility) */
  creatorIssuerId: z.string(),
  createdAt: z.number(),
  /** Expiration time (from bound Access Token) */
  expiresAt: z.number(),
  submittedAt: z.number().optional(),
});

export type TicketDetail = z.infer<typeof TicketDetailSchema>;

/**
 * Create ticket response schema
 *
 * Note: tokenBase64 is obtained in step 1 (POST /api/tokens/delegate),
 * not returned here in step 2.
 */
export const CreateTicketResponseSchema = z.object({
  ticketId: z.string(),
  title: z.string(),
  status: z.literal("pending"),
  /** Bound Access Token ID */
  accessTokenId: z.string(),
});

export type CreateTicketResponse = z.infer<typeof CreateTicketResponseSchema>;
