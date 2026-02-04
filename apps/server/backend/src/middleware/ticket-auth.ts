/**
 * Ticket Authentication Middleware
 *
 * Authenticates using ticket ID from URL path.
 */

import type { MiddlewareHandler } from "hono";
import type { TokensDb } from "../db/tokens.ts";
import type { AuthContext, Env, Ticket } from "../types.ts";

export type TicketAuthDeps = {
  tokensDb: TokensDb;
};

/**
 * Create ticket authentication middleware
 *
 * Ticket ID in path is the credential, no Authorization header needed.
 */
export const createTicketAuthMiddleware = (deps: TicketAuthDeps): MiddlewareHandler<Env> => {
  const { tokensDb } = deps;

  return async (c, next) => {
    const ticketId = c.req.param("ticketId");
    if (!ticketId) {
      return c.json({ error: "Missing ticketId" }, 400);
    }

    const ticket = await tokensDb.getTicket(ticketId);
    if (!ticket) {
      return c.json({ error: "Invalid or expired ticket" }, 401);
    }

    // Build issuerId in ticket format
    const issuerId = `ticket:${ticketId}`;

    // Build auth context from ticket
    const auth: AuthContext = {
      token: ticket,
      userId: ticket.issuerId,
      realm: ticket.realm,
      canRead: true,
      canWrite: !!ticket.commit && !ticket.commit.root,
      canIssueTicket: false,
      allowedScope: ticket.scope,
      identityType: "ticket",
      issuerId,
      isAgent: false, // Tickets are not agents, they have even more restricted permissions
    };

    c.set("auth", auth);
    return next();
  };
};

/**
 * Check ticket read access for a specific key
 */
export const checkTicketReadAccess = (auth: AuthContext, key: string): boolean => {
  // If no scope restriction, all reads are allowed
  if (!auth.allowedScope) return true;

  // Check if key is in allowed scope
  return auth.allowedScope.includes(key);
};

/**
 * Check ticket write quota
 */
export const checkTicketWriteQuota = (auth: AuthContext, size: number): boolean => {
  if (auth.token.type !== "ticket") return true;

  const ticket = auth.token as Ticket;
  if (!ticket.commit) return false;
  if (ticket.commit.root) return false; // Already committed

  const quota = ticket.commit.quota;
  if (!quota) return true; // No quota limit

  // Note: This is a simplified check. Full implementation would track usage.
  return size <= quota;
};
