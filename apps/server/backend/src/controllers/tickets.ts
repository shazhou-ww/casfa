/**
 * Tickets controller for Realm routes
 *
 * Handles ticket management under /api/realm/{realmId}/tickets/*
 * Tickets are created by Access Token holders to allow temporary access to specific nodes.
 */

import type { CreateTicket, TicketSubmit } from "@casfa/protocol";
import type { Context } from "hono";
import type { DepotsDb } from "../db/depots.ts";
import type { TicketsDb } from "../db/tickets.ts";
import type { TicketRecord } from "../types/delegate-token.ts";
import type { AccessTokenAuthContext, Env } from "../types.ts";
import { generateTicketId } from "../util/token-id.ts";

// ============================================================================
// Types
// ============================================================================

export type TicketsController = {
  create: (c: Context<Env>) => Promise<Response>;
  list: (c: Context<Env>) => Promise<Response>;
  get: (c: Context<Env>) => Promise<Response>;
  submit: (c: Context<Env>) => Promise<Response>;
  revoke: (c: Context<Env>) => Promise<Response>;
  delete: (c: Context<Env>) => Promise<Response>;
};

type TicketsControllerDeps = {
  ticketsDb: TicketsDb;
  depotsDb: DepotsDb;
};

// ============================================================================
// Helpers
// ============================================================================

const formatTicketResponse = (ticket: TicketRecord) => {
  return {
    ticketId: ticket.ticketId,
    realm: ticket.realm,
    status: ticket.status,
    title: ticket.title,
    root: ticket.root ?? null,
    creatorIssuerId: ticket.creatorIssuerId,
    accessTokenId: ticket.accessTokenId,
    createdAt: ticket.createdAt,
    submittedAt: ticket.submittedAt,
  };
};

// ============================================================================
// Controller Factory
// ============================================================================

export const createTicketsController = (deps: TicketsControllerDeps): TicketsController => {
  const { ticketsDb } = deps;

  return {
    create: async (c) => {
      const auth = c.get("auth") as AccessTokenAuthContext;
      const realmId = c.req.param("realmId");
      const body = c.req.valid("json" as never) as CreateTicket;

      const ticketId = generateTicketId();

      const ticket = await ticketsDb.create({
        ticketId,
        realm: realmId,
        title: body.title,
        accessTokenId: auth.tokenId,
        creatorIssuerId: auth.tokenId,
      });

      return c.json(
        {
          ticketId: ticket.ticketId,
          realm: ticket.realm,
          title: ticket.title,
          status: ticket.status,
          createdAt: ticket.createdAt,
        },
        201
      );
    },

    list: async (c) => {
      const realmId = c.req.param("realmId");
      const limit = Number.parseInt(c.req.query("limit") ?? "100", 10);
      const cursor = c.req.query("cursor");
      const status = c.req.query("status") as "pending" | "submitted" | undefined;

      const result = await ticketsDb.listByRealm(realmId, {
        limit,
        cursor,
        status,
      });

      return c.json({
        tickets: result.items.map((t: TicketRecord) => formatTicketResponse(t)),
        nextCursor: result.nextCursor,
        hasMore: result.hasMore,
      });
    },

    get: async (c) => {
      const realmId = c.req.param("realmId");
      const ticketId = c.req.param("ticketId");

      const ticket = await ticketsDb.get(realmId, ticketId);
      if (!ticket) {
        return c.json({ error: "not_found", message: "Ticket not found" }, 404);
      }

      return c.json(formatTicketResponse(ticket));
    },

    submit: async (c) => {
      const realmId = c.req.param("realmId");
      const ticketId = c.req.param("ticketId");
      const body = c.req.valid("json" as never) as TicketSubmit;

      const ticket = await ticketsDb.get(realmId, ticketId);
      if (!ticket) {
        return c.json({ error: "not_found", message: "Ticket not found" }, 404);
      }

      if (ticket.status === "submitted") {
        return c.json({ error: "conflict", message: "Ticket already submitted" }, 409);
      }

      const updated = await ticketsDb.submit(realmId, ticketId, body.root);
      if (!updated) {
        return c.json({ error: "conflict", message: "Failed to submit ticket" }, 409);
      }

      return c.json({
        success: true,
        status: "submitted",
        root: body.root,
      });
    },

    revoke: async (c) => {
      const auth = c.get("auth") as AccessTokenAuthContext;
      const realmId = c.req.param("realmId");
      const ticketId = c.req.param("ticketId");

      const ticket = await ticketsDb.get(realmId, ticketId);
      if (!ticket) {
        return c.json({ error: "not_found", message: "Ticket not found" }, 404);
      }

      if (ticket.creatorIssuerId !== auth.tokenId) {
        const canRevoke = auth.issuerChain.includes(ticket.creatorIssuerId);
        if (!canRevoke) {
          return c.json({ error: "forbidden", message: "Not the ticket creator" }, 403);
        }
      }

      const success = await ticketsDb.delete(realmId, ticketId);
      if (!success) {
        return c.json({ error: "conflict", message: "Failed to revoke ticket" }, 409);
      }

      return c.json({ success: true });
    },

    delete: async (c) => {
      const auth = c.get("auth") as AccessTokenAuthContext;
      const realmId = c.req.param("realmId");
      const ticketId = c.req.param("ticketId");

      const ticket = await ticketsDb.get(realmId, ticketId);
      if (!ticket) {
        return c.json({ error: "not_found", message: "Ticket not found" }, 404);
      }

      if (ticket.creatorIssuerId !== auth.tokenId) {
        const canDelete = auth.issuerChain.includes(ticket.creatorIssuerId);
        if (!canDelete) {
          return c.json({ error: "forbidden", message: "Not the ticket creator" }, 403);
        }
      }

      await ticketsDb.delete(realmId, ticketId);
      return c.json({ success: true });
    },
  };
};
