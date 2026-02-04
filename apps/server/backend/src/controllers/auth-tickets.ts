/**
 * Ticket management controller
 */

import type { Context } from "hono";
import type { ServerConfig } from "../config.ts";
import type { TokensDb } from "../db/tokens.ts";
import type { Env } from "../types.ts";
import { extractTokenId } from "../util/token-id.ts";

export type AuthTicketsController = {
  create: (c: Context<Env>) => Promise<Response>;
  revoke: (c: Context<Env>) => Promise<Response>;
};

type AuthTicketsControllerDeps = {
  tokensDb: TokensDb;
  serverConfig: ServerConfig;
};

export const createAuthTicketsController = (
  deps: AuthTicketsControllerDeps
): AuthTicketsController => {
  const { tokensDb, serverConfig } = deps;

  return {
    create: async (c) => {
      const auth = c.get("auth");
      const body = await c.req.json();

      // Use the caller's issuerId directly
      const ticket = await tokensDb.createTicket(auth.realm, auth.issuerId, {
        scope: body.scope,
        commit: body.commit,
        expiresIn: body.expiresIn,
      });

      const ticketId = extractTokenId(ticket.pk);
      const endpoint = `${serverConfig.baseUrl}/api/ticket/${ticketId}`;

      return c.json(
        {
          id: ticketId,
          endpoint,
          expiresAt: new Date(ticket.expiresAt).toISOString(),
          realm: ticket.realm,
          scope: ticket.scope,
          commit: ticket.commit,
          config: ticket.config,
        },
        201
      );
    },

    revoke: async (c) => {
      const auth = c.get("auth");
      const ticketId = c.req.param("id");

      try {
        // User Token (isAgent=false): can revoke any ticket in realm
        // Agent Token / Client (isAgent=true): can only revoke tickets they issued
        const agentIssuerId = auth.isAgent ? auth.issuerId : undefined;
        await tokensDb.revokeTicket(auth.realm, ticketId, agentIssuerId);
        return c.json({ success: true });
      } catch (error: unknown) {
        const err = error as Error;
        const status = err.message.includes("Access denied") ? 403 : 404;
        return c.json({ error: err.message ?? "Ticket not found" }, status);
      }
    },
  };
};
