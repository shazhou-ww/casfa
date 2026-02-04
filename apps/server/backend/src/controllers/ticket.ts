/**
 * Ticket endpoint controller
 */

import type { Context } from "hono";
import type { TokensDb } from "../db/tokens.ts";
import type { UsageDb } from "../db/usage.ts";
import type { Env } from "../types.ts";

export type TicketController = {
  getInfo: (c: Context) => Promise<Response>;
  getUsage: (c: Context<Env>) => Promise<Response>;
};

type TicketControllerDeps = {
  tokensDb: TokensDb;
  usageDb: UsageDb;
};

export const createTicketController = (deps: TicketControllerDeps): TicketController => {
  const { tokensDb, usageDb } = deps;

  return {
    getInfo: async (c) => {
      const ticketId = c.req.param("ticketId");
      const ticket = await tokensDb.getTicket(ticketId);

      if (!ticket) {
        return c.json({ error: "Ticket not found" }, 404);
      }

      if (ticket.expiresAt < Date.now()) {
        return c.json({ error: "Ticket expired" }, 410);
      }

      return c.json({
        realm: ticket.realm,
        scope: ticket.scope,
        commit: ticket.commit,
        expiresAt: new Date(ticket.expiresAt).toISOString(),
        nodeLimit: ticket.config.nodeLimit,
        maxNameBytes: ticket.config.maxNameBytes,
      });
    },

    getUsage: async (c) => {
      const auth = c.get("auth");
      const usage = await usageDb.getUsage(auth.realm);

      return c.json({
        realm: usage.realm,
        physicalBytes: usage.physicalBytes,
        logicalBytes: usage.logicalBytes,
        nodeCount: usage.nodeCount,
        quotaLimit: usage.quotaLimit,
        updatedAt: usage.updatedAt ? new Date(usage.updatedAt).toISOString() : null,
      });
    },
  };
};
