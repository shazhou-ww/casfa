/**
 * Ticket Schemas
 *
 * Zod schemas for Ticket API.
 * Based on docs/delegate-token-refactor/impl/04-controller-refactor.md
 */

import { z } from "zod";

// ============================================================================
// Create Ticket
// ============================================================================

/**
 * Schema for creating a new Ticket
 *
 * Used by: POST /api/realm/:realmId/tickets
 *
 * New flow (two-step):
 *   1. First, delegate an Access Token via POST /api/tokens/delegate
 *   2. Then create a Ticket with that accessTokenId
 */
export const NewCreateTicketSchema = z.object({
  /** Human-readable title for the ticket */
  title: z.string().min(1).max(256),
  /** ID of the pre-issued Access Token to bind to this ticket */
  accessTokenId: z.string().regex(/^dlt1_[0-9A-HJ-KM-NP-TV-Z]{26}$/i, {
    message: "Invalid accessTokenId format",
  }),
});
export type NewCreateTicket = z.infer<typeof NewCreateTicketSchema>;

// ============================================================================
// Submit Ticket
// ============================================================================

/**
 * Schema for submitting a Ticket (setting the output root)
 *
 * Used by: POST /api/realm/:realmId/tickets/:ticketId/submit
 *
 * Replaces the old "commit" endpoint.
 */
export const TicketSubmitSchema = z.object({
  /** Root node hash (the output of this ticket's work) */
  root: z.string().regex(/^[a-f0-9]{64}$/, {
    message: "Invalid root node hash format (expected 64 hex chars)",
  }),
});
export type TicketSubmit = z.infer<typeof TicketSubmitSchema>;

// ============================================================================
// Ticket Query Params
// ============================================================================

/**
 * Schema for listing tickets query parameters
 */
export const ListTicketsQuerySchema = z.object({
  limit: z
    .string()
    .optional()
    .transform((v) => (v ? parseInt(v, 10) : 20))
    .pipe(z.number().int().min(1).max(100)),
  cursor: z.string().optional(),
  status: z.enum(["pending", "submitted"]).optional(),
});
export type ListTicketsQuery = z.infer<typeof ListTicketsQuerySchema>;

// ============================================================================
// Ticket ID Validation
// ============================================================================

/**
 * Ticket ID regex pattern
 */
export const TICKET_ID_REGEX = /^ticket:[a-zA-Z0-9]+$/;

/**
 * Ticket ID schema
 */
export const TicketIdSchema = z.string().regex(TICKET_ID_REGEX, {
  message: "Invalid ticket ID format. Expected: ticket:{ulid}",
});
