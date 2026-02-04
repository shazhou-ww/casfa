/**
 * Tickets controller for Realm routes
 *
 * Handles ticket management under /api/realm/{realmId}/tickets/*
 */

import { CreateTicketSchema, TicketCommitSchema } from "@casfa/protocol";
import type { Context } from "hono";
import type { ServerConfig } from "../config.ts";
import type { TokensDb } from "../db/tokens.ts";
import type { Env, Ticket } from "../types.ts";
import { extractTokenId } from "../util/token-id.ts";

// ============================================================================
// Types
// ============================================================================

export type TicketsController = {
  create: (c: Context<Env>) => Promise<Response>;
  list: (c: Context<Env>) => Promise<Response>;
  get: (c: Context<Env>) => Promise<Response>;
  commit: (c: Context<Env>) => Promise<Response>;
  revoke: (c: Context<Env>) => Promise<Response>;
  delete: (c: Context<Env>) => Promise<Response>;
};

type TicketsControllerDeps = {
  tokensDb: TokensDb;
  serverConfig: ServerConfig;
};

// ============================================================================
// Helpers
// ============================================================================

const deriveTicketStatus = (ticket: Ticket): string => {
  if (ticket.commit?.root && ticket.isRevoked) return "archived";
  if (ticket.commit?.root) return "committed";
  if (ticket.isRevoked) return "revoked";
  return "issued";
};

const formatTicketResponse = (ticket: Ticket, includeConfig = false) => {
  const ticketId = extractTokenId(ticket.pk);
  const base = {
    ticketId: `ticket:${ticketId}`,
    realm: ticket.realm,
    status: deriveTicketStatus(ticket),
    purpose: ticket.purpose,
    input: ticket.scope,
    output: ticket.commit?.root ?? null,
    isRevoked: ticket.isRevoked ?? false,
    issuerId: ticket.issuerId,
    writable: !!ticket.commit,
    createdAt: ticket.createdAt,
    expiresAt: ticket.expiresAt,
  };

  if (includeConfig && ticket.config) {
    return {
      ...base,
      config: {
        nodeLimit: ticket.config.nodeLimit,
        maxNameBytes: ticket.config.maxNameBytes,
        quota: ticket.commit?.quota,
        accept: ticket.commit?.accept,
      },
    };
  }

  return base;
};

// ============================================================================
// Controller Factory
// ============================================================================

export const createTicketsController = (deps: TicketsControllerDeps): TicketsController => {
  const { tokensDb, serverConfig } = deps;

  return {
    create: async (c) => {
      const auth = c.get("auth");
      const realmId = c.req.param("realmId");
      const body = CreateTicketSchema.parse(await c.req.json());

      // Use the caller's issuerId directly
      const issuerId = auth.issuerId;

      const ticket = await tokensDb.createTicket(realmId, issuerId, {
        scope: body.input,
        purpose: body.purpose,
        commit: body.writable,
        expiresIn: body.expiresIn,
      });

      const ticketId = extractTokenId(ticket.pk);

      return c.json({
        ticketId: `ticket:${ticketId}`,
        realm: ticket.realm,
        input: ticket.scope,
        writable: !!ticket.commit,
        config: {
          nodeLimit: serverConfig.nodeLimit,
          maxNameBytes: serverConfig.maxNameBytes,
          quota: ticket.commit?.quota,
          accept: ticket.commit?.accept,
        },
        expiresAt: ticket.expiresAt,
      });
    },

    list: async (c) => {
      const realmId = c.req.param("realmId");
      const limit = Number.parseInt(c.req.query("limit") ?? "100", 10);
      const cursor = c.req.query("cursor");
      const statusFilter = c.req.query("status");

      const result = await tokensDb.listTicketsByRealm(realmId, { limit, cursor });

      let tickets = result.tickets.map((t) => formatTicketResponse(t, false));

      // Filter by status if specified
      if (statusFilter) {
        tickets = tickets.filter((t) => t.status === statusFilter);
      }

      return c.json({
        tickets,
        nextCursor: result.nextCursor,
        hasMore: result.hasMore,
      });
    },

    get: async (c) => {
      const realmId = c.req.param("realmId");
      const rawTicketId = c.req.param("ticketId");
      const ticketId = rawTicketId.startsWith("ticket:") ? rawTicketId.slice(7) : rawTicketId;

      // Check if using Ticket auth - only allow accessing own ticket
      const auth = c.get("auth");
      if (auth.identityType === "ticket") {
        const authTicketId = extractTokenId(auth.token.pk);
        if (authTicketId !== ticketId) {
          return c.json({ error: "forbidden", message: "Can only access own ticket" }, 403);
        }
      }

      const ticket = await tokensDb.getTicket(ticketId);
      if (!ticket || ticket.realm !== realmId) {
        return c.json({ error: "not_found", message: "Ticket not found" }, 404);
      }

      return c.json(formatTicketResponse(ticket, true));
    },

    commit: async (c) => {
      const realmId = c.req.param("realmId");
      const rawTicketId = c.req.param("ticketId");
      const ticketId = rawTicketId.startsWith("ticket:") ? rawTicketId.slice(7) : rawTicketId;
      const { output } = TicketCommitSchema.parse(await c.req.json());

      // Only Ticket auth can commit
      const auth = c.get("auth");
      if (auth.identityType !== "ticket") {
        return c.json({ error: "forbidden", message: "Only Ticket can commit" }, 403);
      }

      // Can only commit own ticket
      const authTicketId = extractTokenId(auth.token.pk);
      if (authTicketId !== ticketId) {
        return c.json({ error: "forbidden", message: "Can only commit own ticket" }, 403);
      }

      const ticket = await tokensDb.getTicket(ticketId);
      if (!ticket || ticket.realm !== realmId) {
        return c.json({ error: "not_found", message: "Ticket not found" }, 404);
      }

      // Check if writable
      if (!ticket.commit) {
        return c.json({ error: "forbidden", message: "Ticket is read-only" }, 403);
      }

      // Check if already committed
      if (ticket.commit.root) {
        return c.json({ error: "conflict", message: "Ticket already committed" }, 409);
      }

      // Check if revoked or expired
      if (ticket.isRevoked || ticket.expiresAt < Date.now()) {
        return c.json({ error: "gone", message: "Ticket is revoked or expired" }, 410);
      }

      // TODO: Verify output node exists in storage

      const success = await tokensDb.markTicketCommitted(ticketId, output);
      if (!success) {
        return c.json({ error: "conflict", message: "Ticket already committed" }, 409);
      }

      return c.json({
        success: true,
        status: "committed",
        output,
        isRevoked: false,
      });
    },

    revoke: async (c) => {
      const realmId = c.req.param("realmId");
      const rawTicketId = c.req.param("ticketId");
      const ticketId = rawTicketId.startsWith("ticket:") ? rawTicketId.slice(7) : rawTicketId;
      const auth = c.get("auth");

      const ticket = await tokensDb.getTicket(ticketId);
      if (!ticket || ticket.realm !== realmId) {
        return c.json({ error: "not_found", message: "Ticket not found" }, 404);
      }

      // Check if already revoked
      if (ticket.isRevoked) {
        return c.json({ error: "conflict", message: "Ticket already revoked" }, 409);
      }

      // Permission check: only issuer can revoke (for agents, use issuerId)
      const agentIssuerId = auth.isAgent ? auth.issuerId : undefined;
      try {
        await tokensDb.revokeTicket(realmId, ticketId, agentIssuerId);
      } catch (error: unknown) {
        const err = error as Error;
        if (err.message.includes("Access denied")) {
          return c.json({ error: "forbidden", message: "Not the ticket issuer" }, 403);
        }
        throw error;
      }

      const hasOutput = !!ticket.commit?.root;
      return c.json({
        success: true,
        status: hasOutput ? "archived" : "revoked",
        output: ticket.commit?.root,
        isRevoked: true,
      });
    },

    delete: async (c) => {
      const realmId = c.req.param("realmId");
      const rawTicketId = c.req.param("ticketId");
      const ticketId = rawTicketId.startsWith("ticket:") ? rawTicketId.slice(7) : rawTicketId;
      const auth = c.get("auth");

      // Only User Token can delete (not Agent Token)
      if (auth.isAgent) {
        return c.json(
          { error: "forbidden", message: "Agent Token cannot delete, only revoke" },
          403
        );
      }

      const ticket = await tokensDb.getTicket(ticketId);
      if (!ticket || ticket.realm !== realmId) {
        return c.json({ error: "not_found", message: "Ticket not found" }, 404);
      }

      await tokensDb.deleteToken(ticketId);

      return c.json({ success: true });
    },
  };
};
