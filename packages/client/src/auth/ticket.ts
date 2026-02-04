/**
 * Ticket authentication strategy.
 */

import type { AuthStrategy, TicketAuthState } from "../types/auth.ts";

export type TicketAuthConfig = {
  /** Ticket ID */
  ticketId: string;
  /** Realm ID (optional, will be resolved from ticket info) */
  realmId?: string;
  /** Permitted scopes (optional, will be resolved from ticket info) */
  scope?: string[];
  /** Whether ticket has write permission */
  writable?: boolean;
  /** Ticket expiration (ms since epoch) */
  expiresAt?: number;
};

/**
 * Create a ticket authentication strategy.
 */
export const createTicketAuth = (config: TicketAuthConfig): AuthStrategy => {
  const { ticketId, realmId, scope, writable, expiresAt } = config;

  const state: TicketAuthState = {
    type: "ticket",
    ticketId,
    realmId: realmId ?? null,
    scope: scope ?? null,
    writable: writable ?? null,
    expiresAt: expiresAt ?? null,
  };

  const getState = (): TicketAuthState => ({ ...state });

  const getAuthHeader = async (): Promise<string> => {
    return `Ticket ${state.ticketId}`;
  };

  const initialize = async (): Promise<void> => {
    // Ticket info would be fetched if not provided
    // This is typically done by the CasfaClient after creation
  };

  const handleUnauthorized = async (): Promise<boolean> => {
    // Check if ticket is expired
    if (state.expiresAt && Date.now() > state.expiresAt) {
      // Ticket is expired, cannot recover
      return false;
    }
    // Ticket might be revoked or invalid
    return false;
  };

  /**
   * Check if the ticket allows access to a given path.
   */
  const canAccessPath = (path: string): boolean => {
    if (!state.scope) {
      // If scope is not set, assume full access (will be validated server-side)
      return true;
    }
    return state.scope.some((s) => path === s || path.startsWith(s.endsWith("/") ? s : `${s}/`));
  };

  /**
   * Check if the ticket allows write operations.
   */
  const canWrite = (): boolean => {
    return state.writable === true;
  };

  /**
   * Update ticket info after fetching from server.
   */
  const updateInfo = (info: {
    realmId?: string;
    scope?: string[];
    writable?: boolean;
    expiresAt?: number;
  }) => {
    if (info.realmId !== undefined) state.realmId = info.realmId;
    if (info.scope !== undefined) state.scope = info.scope;
    if (info.writable !== undefined) state.writable = info.writable;
    if (info.expiresAt !== undefined) state.expiresAt = info.expiresAt;
  };

  return {
    getState,
    getAuthHeader,
    initialize,
    handleUnauthorized,
    // Additional methods for ticket operations
    canAccessPath,
    canWrite,
    updateInfo,
  } as AuthStrategy & {
    canAccessPath: typeof canAccessPath;
    canWrite: typeof canWrite;
    updateInfo: typeof updateInfo;
  };
};

export type TicketAuthStrategy = ReturnType<typeof createTicketAuth>;
