/**
 * Ticket methods for the stateful client.
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
import type { StoredAccessToken } from "../types/tokens.ts";
import { withAccessToken, withDelegateToken } from "./helpers.ts";

// ============================================================================
// Types
// ============================================================================

export type TicketMethods = {
  /** Create a new ticket (Delegate Token required) */
  create: (
    params: CreateTicket
  ) => Promise<FetchResult<{ ticketId: string; accessToken: StoredAccessToken }>>;
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
  const requireDelegate = withDelegateToken(() => tokenSelector.ensureDelegateToken());
  const requireAccess = withAccessToken(() => tokenSelector.ensureAccessToken());

  return {
    create: (params) =>
      requireDelegate(async (delegate) => {
        const result = await api.createTicket(baseUrl, realm, delegate.tokenBase64, params);
        if (!result.ok) return result;

        const accessToken: StoredAccessToken = {
          tokenId: (result.data as CreateTicketResponse & { accessTokenId: string }).accessTokenId,
          tokenBase64: (result.data as CreateTicketResponse & { accessTokenBase64: string })
            .accessTokenBase64,
          type: "access",
          issuerId: delegate.tokenId,
          expiresAt: result.data.expiresAt,
          canUpload: params.canUpload ?? false,
          canManageDepot: false,
        };

        return {
          ok: true,
          data: { ticketId: result.data.ticketId, accessToken },
          status: result.status,
        };
      }),

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
