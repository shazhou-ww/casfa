/**
 * Ticket API functions.
 *
 * Token Requirement:
 * - POST /api/realm/{realmId}/tickets: Access Token (create ticket, bind pre-issued token)
 * - GET /api/realm/{realmId}/tickets: Access Token (list)
 * - GET /api/realm/{realmId}/tickets/:ticketId: Access Token (get detail)
 * - POST /api/realm/{realmId}/tickets/:ticketId/submit: Access Token (submit)
 *
 * Design Principle: All Realm data operations use Access Token.
 * Delegate Token is only for issuing tokens.
 *
 * Two-step Ticket creation flow:
 *   1. Issue Access Token using Delegate Token (POST /api/tokens/delegate)
 *   2. Create Ticket and bind the token (POST /api/realm/{realmId}/tickets)
 */

import type {
  CreateTicket,
  CreateTicketResponse,
  ListTicketsQuery,
  TicketDetail,
  TicketListItem,
  TicketSubmit,
} from "@casfa/protocol";
import type { FetchResult } from "../types/client.ts";
import { fetchWithAuth } from "../utils/http.ts";

// ============================================================================
// Types
// ============================================================================

export type ListTicketsResponse = {
  tickets: TicketListItem[];
  nextCursor?: string;
};

export type SubmitTicketResponse = {
  ticketId: string;
  status: "submitted";
  root: string;
  submittedAt: number;
};

// ============================================================================
// Access Token APIs
// ============================================================================

/**
 * Create a new ticket and bind a pre-issued Access Token.
 * Requires Access Token.
 *
 * @param accessTokenBase64 - Caller's Access Token (for authentication)
 * @param params.accessTokenId - Pre-issued Access Token ID to bind (for Tool use)
 */
export const createTicket = async (
  baseUrl: string,
  realm: string,
  accessTokenBase64: string,
  params: CreateTicket
): Promise<FetchResult<CreateTicketResponse>> => {
  return fetchWithAuth<CreateTicketResponse>(
    `${baseUrl}/api/realm/${encodeURIComponent(realm)}/tickets`,
    `Bearer ${accessTokenBase64}`,
    {
      method: "POST",
      body: params,
    }
  );
};

/**
 * List tickets.
 * Requires Access Token.
 */
export const listTickets = async (
  baseUrl: string,
  realm: string,
  accessTokenBase64: string,
  params?: ListTicketsQuery
): Promise<FetchResult<ListTicketsResponse>> => {
  const query = new URLSearchParams();
  if (params?.limit) query.set("limit", String(params.limit));
  if (params?.cursor) query.set("cursor", params.cursor);
  if (params?.status) query.set("status", params.status);

  const queryString = query.toString();
  const url = `${baseUrl}/api/realm/${encodeURIComponent(realm)}/tickets${queryString ? `?${queryString}` : ""}`;

  return fetchWithAuth<ListTicketsResponse>(url, `Bearer ${accessTokenBase64}`);
};

/**
 * Get ticket details.
 * Requires Access Token.
 */
export const getTicket = async (
  baseUrl: string,
  realm: string,
  accessTokenBase64: string,
  ticketId: string
): Promise<FetchResult<TicketDetail>> => {
  return fetchWithAuth<TicketDetail>(
    `${baseUrl}/api/realm/${encodeURIComponent(realm)}/tickets/${encodeURIComponent(ticketId)}`,
    `Bearer ${accessTokenBase64}`
  );
};

/**
 * Submit a ticket.
 * Requires Access Token.
 */
export const submitTicket = async (
  baseUrl: string,
  realm: string,
  accessTokenBase64: string,
  ticketId: string,
  params: TicketSubmit
): Promise<FetchResult<SubmitTicketResponse>> => {
  return fetchWithAuth<SubmitTicketResponse>(
    `${baseUrl}/api/realm/${encodeURIComponent(realm)}/tickets/${encodeURIComponent(ticketId)}/submit`,
    `Bearer ${accessTokenBase64}`,
    {
      method: "POST",
      body: params,
    }
  );
};
