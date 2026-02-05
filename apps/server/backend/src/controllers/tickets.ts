/**
 * Tickets controller for Realm routes
 *
 * Handles ticket management under /api/realm/{realmId}/tickets/*
 * Tickets are created by Access Token holders to allow temporary access to specific nodes.
 */

import type { Context } from "hono";
import type { TicketsDb } from "../db/tickets.ts";
import type { DepotsDb } from "../db/depots.ts";
import type { TicketRecord } from "../types/delegate-token.ts";
import type { AccessTokenAuthContext, Env } from "../types.ts";

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

const deriveTicketStatus = (ticket: TicketRecord): string => {
  if (ticket.status === "revoked") return "revoked";
  if (ticket.status === "submitted") return "submitted";
  if (ticket.status === "expired" || ticket.expiresAt < Date.now()) return "expired";
  return "issued";
};

const formatTicketResponse = (ticket: TicketRecord, includeDetails = false) => {
  const base = {
    ticketId: ticket.ticketId,
    realm: ticket.realm,
    status: deriveTicketStatus(ticket),
    title: ticket.title,
    output: ticket.submittedRoot ?? null,
    creatorIssuerId: ticket.creatorIssuerId,
    canUpload: ticket.canUpload,
    createdAt: ticket.createdAt,
    expiresAt: ticket.expiresAt,
  };

  if (includeDetails) {
    return {
      ...base,
      scopeNodeHash: ticket.scopeNodeHash,
      scopeSetNodeId: ticket.scopeSetNodeId,
    };
  }

  return base;
};

// ============================================================================
// Controller Factory
// ============================================================================

export const createTicketsController = (deps: TicketsControllerDeps): TicketsController => {
  const { ticketsDb, depotsDb } = deps;

  return {
    create: async (c) => {
      const auth = c.get("auth") as AccessTokenAuthContext;
      const realmId = c.req.param("realmId");
      const body = await c.req.json();

      const ticket = await ticketsDb.create({
        realm: realmId,
        title: body.title,
        canUpload: body.canUpload ?? false,
        expiresIn: body.expiresIn ?? 3600, // Default 1 hour
        creatorIssuerId: auth.tokenId,
        scopeNodeHash: auth.tokenRecord.scopeNodeHash,
        scopeSetNodeId: auth.tokenRecord.scopeSetNodeId,
      });

      return c.json(
        {
          ticketId: ticket.ticketId,
          realm: ticket.realm,
          title: ticket.title,
          canUpload: ticket.canUpload,
          expiresAt: ticket.expiresAt,
        },
        201
      );
    },

    list: async (c) => {
      const auth = c.get("auth") as AccessTokenAuthContext;
      const realmId = c.req.param("realmId");
      const limit = Number.parseInt(c.req.query("limit") ?? "100", 10);
      const cursor = c.req.query("cursor");

      // List tickets created by the caller's issuer chain
      const result = await ticketsDb.listByRealm(realmId, {
        limit,
        cursor,
        creatorIssuerId: auth.tokenId,
      });

      return c.json({
        tickets: result.tickets.map((t) => formatTicketResponse(t, false)),
        nextCursor: result.nextCursor,
        hasMore: result.hasMore,
      });
    },

    get: async (c) => {
      const realmId = c.req.param("realmId");
      const ticketId = c.req.param("ticketId");

      const ticket = await ticketsDb.get(ticketId);
      if (!ticket || ticket.realm !== realmId) {
        return c.json({ error: "not_found", message: "Ticket not found" }, 404);
      }

      return c.json(formatTicketResponse(ticket, true));
    },

    submit: async (c) => {
      const realmId = c.req.param("realmId");
      const ticketId = c.req.param("ticketId");
      const body = await c.req.json();

      const ticket = await ticketsDb.get(ticketId);
      if (!ticket || ticket.realm !== realmId) {
        return c.json({ error: "not_found", message: "Ticket not found" }, 404);
      }

      // Check if already submitted
      if (ticket.status === "submitted") {
        return c.json({ error: "conflict", message: "Ticket already submitted" }, 409);
      }

      // Check if revoked or expired
      if (ticket.status === "revoked" || ticket.expiresAt < Date.now()) {
        return c.json({ error: "gone", message: "Ticket is revoked or expired" }, 410);
      }

      // Check if writable
      if (!ticket.canUpload) {
        return c.json({ error: "forbidden", message: "Ticket is read-only" }, 403);
      }

      const success = await ticketsDb.submit(ticketId, body.output);
      if (!success) {
        return c.json({ error: "conflict", message: "Failed to submit ticket" }, 409);
      }

      return c.json({
        success: true,
        status: "submitted",
        output: body.output,
      });
    },

    revoke: async (c) => {
      const auth = c.get("auth") as AccessTokenAuthContext;
      const realmId = c.req.param("realmId");
      const ticketId = c.req.param("ticketId");

      const ticket = await ticketsDb.get(ticketId);
      if (!ticket || ticket.realm !== realmId) {
        return c.json({ error: "not_found", message: "Ticket not found" }, 404);
      }

      // Check if already revoked
      if (ticket.status === "revoked") {
        return c.json({ error: "conflict", message: "Ticket already revoked" }, 409);
      }

      // Check permission: only creator can revoke
      if (ticket.creatorIssuerId !== auth.tokenId) {
        // Check if caller is in creator's issuer chain
        const canRevoke = auth.issuerChain.includes(ticket.creatorIssuerId);
        if (!canRevoke) {
          return c.json({ error: "forbidden", message: "Not the ticket creator" }, 403);
        }
      }

      const success = await ticketsDb.revoke(ticketId);
      if (!success) {
        return c.json({ error: "conflict", message: "Failed to revoke ticket" }, 409);
      }

      return c.json({
        success: true,
        status: "revoked",
        output: ticket.submittedRoot,
      });
    },

    delete: async (c) => {
      const auth = c.get("auth") as AccessTokenAuthContext;
      const realmId = c.req.param("realmId");
      const ticketId = c.req.param("ticketId");

      const ticket = await ticketsDb.get(ticketId);
      if (!ticket || ticket.realm !== realmId) {
        return c.json({ error: "not_found", message: "Ticket not found" }, 404);
      }

      // Check permission: only creator can delete
      if (ticket.creatorIssuerId !== auth.tokenId) {
        // Check if caller is in creator's issuer chain
        const canDelete = auth.issuerChain.includes(ticket.creatorIssuerId);
        if (!canDelete) {
          return c.json({ error: "forbidden", message: "Not the ticket creator" }, 403);
        }
      }

      await ticketsDb.delete(ticketId);

      return c.json({ success: true });
    },
  };
};
