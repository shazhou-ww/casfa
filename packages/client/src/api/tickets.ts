/**
 * Ticket API functions.
 */

import type {
  CreateTicket,
  PaginatedResponse,
  TicketInfo,
  TicketListItem,
  TicketStatus,
  WritableConfig,
} from "../types/api.ts";
import type { Fetcher, FetchResult } from "../utils/fetch.ts";

/**
 * Ticket API context.
 */
export type TicketApiContext = {
  fetcher: Fetcher;
  realmId: string;
};

/**
 * Create a new ticket.
 */
export type CreateTicketParams = {
  input?: string[];
  purpose?: string;
  writable?: WritableConfig;
  expiresIn?: number; // seconds
};

export const createTicket = async (
  ctx: TicketApiContext,
  params: CreateTicketParams = {}
): Promise<FetchResult<TicketInfo>> => {
  const body: CreateTicket = {
    input: params.input,
    purpose: params.purpose,
    writable: params.writable,
    expiresIn: params.expiresIn,
  };

  return ctx.fetcher.request<TicketInfo>(`/api/realm/${ctx.realmId}/tickets`, {
    method: "POST",
    body,
  });
};

/**
 * List tickets.
 */
export type ListTicketsParams = {
  cursor?: string;
  limit?: number;
  status?: TicketStatus;
};

export const listTickets = async (
  ctx: TicketApiContext,
  params: ListTicketsParams = {}
): Promise<FetchResult<PaginatedResponse<TicketListItem>>> => {
  const query = new URLSearchParams();
  if (params.cursor) query.set("cursor", params.cursor);
  if (params.limit) query.set("limit", params.limit.toString());
  if (params.status) query.set("status", params.status);

  const queryStr = query.toString();
  const path = `/api/realm/${ctx.realmId}/tickets${queryStr ? `?${queryStr}` : ""}`;

  return ctx.fetcher.request<PaginatedResponse<TicketListItem>>(path);
};

/**
 * Get ticket details.
 */
export type GetTicketParams = {
  ticketId: string;
};

export const getTicket = async (
  ctx: TicketApiContext,
  params: GetTicketParams
): Promise<FetchResult<TicketInfo>> => {
  return ctx.fetcher.request<TicketInfo>(`/api/realm/${ctx.realmId}/tickets/${params.ticketId}`);
};

/**
 * Commit ticket result.
 */
export type CommitTicketParams = {
  ticketId: string;
  output: string; // Node key of result
};

export const commitTicket = async (
  ctx: TicketApiContext,
  params: CommitTicketParams
): Promise<FetchResult<TicketInfo>> => {
  return ctx.fetcher.request<TicketInfo>(
    `/api/realm/${ctx.realmId}/tickets/${params.ticketId}/commit`,
    {
      method: "POST",
      body: { output: params.output },
    }
  );
};

/**
 * Revoke a ticket.
 */
export type RevokeTicketParams = {
  ticketId: string;
};

export const revokeTicket = async (
  ctx: TicketApiContext,
  params: RevokeTicketParams
): Promise<FetchResult<TicketInfo>> => {
  return ctx.fetcher.request<TicketInfo>(
    `/api/realm/${ctx.realmId}/tickets/${params.ticketId}/revoke`,
    { method: "POST" }
  );
};

/**
 * Delete a ticket (user only).
 */
export type DeleteTicketParams = {
  ticketId: string;
};

export const deleteTicket = async (
  ctx: TicketApiContext,
  params: DeleteTicketParams
): Promise<FetchResult<{ success: boolean }>> => {
  return ctx.fetcher.request<{ success: boolean }>(
    `/api/realm/${ctx.realmId}/tickets/${params.ticketId}`,
    { method: "DELETE" }
  );
};
