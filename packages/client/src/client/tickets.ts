/**
 * Ticket methods for the stateful client.
 *
 * Design Principle: All Realm data operations use Access Token.
 * Delegate Token is only for issuing tokens.
 *
 * Two-step Ticket creation flow:
 *   1. Issue Access Token using tokens.delegate() (requires Delegate Token)
 *   2. Create Ticket using tickets.create() (requires Access Token)
 */

import type {
  CreateTicket,
  CreateTicketResponse,
  ListTicketsQuery,
  TicketDetail,
  TicketSubmit,
} from "@casfa/protocol";
import * as api from "../api/index.ts";
import type { TokenSelector } from "../store/token-selector.ts";
import type { FetchResult } from "../types/client.ts";
import { withAccessToken } from "./helpers.ts";

// ============================================================================
// Types
// ============================================================================

export type TicketMethods = {
  /**
   * Create a new ticket and bind a pre-issued Access Token.
   * Requires Access Token.
   *
   * Note: The Access Token to bind must be issued first using tokens.delegate().
   *
   * @param params.accessTokenId - Pre-issued Access Token ID to bind (for Tool use)
   */
  create: (params: CreateTicket) => Promise<FetchResult<CreateTicketResponse>>;
  /** List tickets */
  list: (params?: ListTicketsQuery) => Promise<FetchResult<api.ListTicketsResponse>>;
  /** Get ticket details */
  get: (ticketId: string) => Promise<FetchResult<TicketDetail>>;
  /** Submit ticket */
  submit: (
    ticketId: string,
    params: TicketSubmit
  ) => Promise<FetchResult<api.SubmitTicketResponse>>;
};

export type TicketDeps = {
  baseUrl: string;
  realm: string;
  tokenSelector: TokenSelector;
};

// ============================================================================
// Factory
// ============================================================================

export const createTicketMethods = ({
  baseUrl,
  realm,
  tokenSelector,
}: TicketDeps): TicketMethods => {
  const requireAccess = withAccessToken(() => tokenSelector.ensureAccessToken());

  return {
    create: (params) =>
      requireAccess((access) => api.createTicket(baseUrl, realm, access.tokenBase64, params)),

    list: (params) =>
      requireAccess((access) => api.listTickets(baseUrl, realm, access.tokenBase64, params)),

    get: (ticketId) =>
      requireAccess((access) => api.getTicket(baseUrl, realm, access.tokenBase64, ticketId)),

    submit: (ticketId, params) =>
      requireAccess((access) =>
        api.submitTicket(baseUrl, realm, access.tokenBase64, ticketId, params)
      ),
  };
};
