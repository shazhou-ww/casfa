/**
 * Authentication Middleware for Hono
 *
 * Supports:
 * 1. Bearer Token (Agent Token / Ticket)
 * 2. Bearer JWT (via configurable JwtVerifier)
 * 3. AWP Signed Requests (ECDSA P-256)
 */

import { createHash } from "node:crypto";
import { AWP_AUTH_HEADERS, validateTimestamp, verifySignature } from "@casfa/auth";
import type { MiddlewareHandler } from "hono";
import type { AwpPubkeysDb } from "../db/awp-pubkeys.ts";
import type { TokensDb } from "../db/tokens.ts";
import type { UserRolesDb } from "../db/user-roles.ts";
import type { AgentToken, AuthContext, Env, Token } from "../types.ts";
import { computeClientId, computeTokenId } from "../util/client-id.ts";

// ============================================================================
// Types
// ============================================================================

/**
 * JWT Verifier callback type
 *
 * Verifies a JWT token and returns the user ID and optional expiration time.
 * Returns null if verification fails.
 */
export type JwtVerifier = (
  token: string
) => Promise<{ userId: string; exp?: number; email?: string; name?: string } | null>;

export type AuthMiddlewareDeps = {
  tokensDb: TokensDb;
  userRolesDb: UserRolesDb;
  awpPubkeysDb: AwpPubkeysDb;
  /** Optional JWT verifier callback. If not provided, JWT auth is disabled. */
  jwtVerifier?: JwtVerifier;
};

// ============================================================================
// Middleware Factory
// ============================================================================

export const createAuthMiddleware = (deps: AuthMiddlewareDeps): MiddlewareHandler<Env> => {
  const { tokensDb, userRolesDb, awpPubkeysDb, jwtVerifier } = deps;

  const applyUserRole = async (auth: AuthContext): Promise<AuthContext> => {
    if (!auth.userId) return auth;

    const role = await userRolesDb.getRole(auth.userId);
    auth.role = role;

    if (role === "unauthorized") {
      auth.canRead = false;
      auth.canWrite = false;
      auth.canIssueTicket = false;
      auth.canManageUsers = false;
    } else if (role === "authorized") {
      auth.canRead = true;
      auth.canWrite = true;
      auth.canIssueTicket = true;
      auth.canManageUsers = false;
    } else {
      // admin
      auth.canRead = true;
      auth.canWrite = true;
      auth.canIssueTicket = true;
      auth.canManageUsers = true;
    }

    return auth;
  };

  const authenticateBearer = async (authHeader: string): Promise<AuthContext | null> => {
    const parts = authHeader.split(" ");
    if (parts.length !== 2) return null;

    const [scheme, tokenValue] = parts;

    // Ticket Token: "Ticket {ticketId}" (format: ticket:xxx or raw xxx)
    if (scheme === "Ticket" && tokenValue) {
      const rawTicketId = tokenValue.startsWith("ticket:") ? tokenValue.slice(7) : tokenValue;
      // Use getTicketRaw to get ticket even if expired (for 410 vs 401 distinction)
      const ticket = await tokensDb.getTicketRaw(rawTicketId);
      if (!ticket) return null;

      // Check if expired or revoked - return special marker for 410
      if (ticket.expiresAt < Date.now() || ticket.isRevoked) {
        return { expired: true } as unknown as AuthContext;
      }

      const issuerId = `ticket:${rawTicketId}`;
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
        isAgent: false,
      };
      return auth; // Don't apply user role for tickets
    }

    // Agent Token: "Agent {token}" (token format: casfa_xxx or raw xxx)
    if (scheme === "Agent" && tokenValue) {
      // Extract token ID from casfa_ prefix if present
      const rawTokenId = tokenValue.startsWith("casfa_") ? tokenValue.slice(6) : tokenValue;
      const token = await tokensDb.getToken(rawTokenId);
      if (!token || token.type !== "agent") return null;

      const agentToken = token as AgentToken;
      const issuerId = computeTokenId(tokenValue);
      const auth: AuthContext = {
        token,
        userId: agentToken.userId,
        realm: `usr_${agentToken.userId}`,
        canRead: true,
        canWrite: true,
        canIssueTicket: true,
        identityType: "agent",
        issuerId,
        isAgent: true,
      };
      return applyUserRole(auth);
    }

    // Bearer JWT or stored token
    if (scheme === "Bearer" && tokenValue) {
      // Try as stored token first
      const storedToken = await tokensDb.getToken(tokenValue);
      if (storedToken) {
        if (storedToken.type === "user") {
          const issuerId = `user:${storedToken.userId}`;
          const auth: AuthContext = {
            token: storedToken,
            userId: storedToken.userId,
            realm: `usr_${storedToken.userId}`,
            canRead: true,
            canWrite: true,
            canIssueTicket: true,
            identityType: "user",
            issuerId,
            isAgent: false,
          };
          return applyUserRole(auth);
        }
        if (storedToken.type === "agent") {
          const agentToken = storedToken as AgentToken;
          const issuerId = computeTokenId(tokenValue);
          const auth: AuthContext = {
            token: storedToken,
            userId: agentToken.userId,
            realm: `usr_${agentToken.userId}`,
            canRead: true,
            canWrite: true,
            canIssueTicket: true,
            identityType: "agent",
            issuerId,
            isAgent: true,
          };
          return applyUserRole(auth);
        }
      }

      // Try as JWT using configurable verifier
      if (jwtVerifier && tokenValue) {
        try {
          const result = await jwtVerifier(tokenValue);
          if (!result) return null;

          const { userId, exp, email, name } = result;
          const issuerId = `user:${userId}`;
          const syntheticToken: Token = {
            pk: `token#jwt_${userId}`,
            sk: "TOKEN",
            type: "user",
            userId,
            createdAt: Date.now(),
            expiresAt: exp ? exp * 1000 : Date.now() + 3600000,
          };

          const auth: AuthContext = {
            token: syntheticToken,
            userId,
            realm: `usr_${userId}`,
            canRead: true,
            canWrite: true,
            canIssueTicket: true,
            identityType: "user",
            issuerId,
            isAgent: false,
            email,
            name,
          };
          return applyUserRole(auth);
        } catch {
          // JWT verification failed
        }
      }
    }

    return null;
  };

  const authenticateAwp = async (
    pubkey: string,
    timestamp: string,
    signature: string,
    method: string,
    path: string,
    body: string
  ): Promise<AuthContext | null> => {
    // Validate timestamp
    if (!validateTimestamp(timestamp, 300)) {
      return null;
    }

    // Look up pubkey
    const authorizedPubkey = await awpPubkeysDb.lookup(pubkey);
    if (!authorizedPubkey) return null;

    // Build signature payload
    const bodyHash = body ? createHash("sha256").update(body).digest("hex") : "";
    const payload = `${timestamp}.${method}.${path}.${bodyHash}`;

    // Verify signature
    const isValid = await verifySignature(pubkey, payload, signature);
    if (!isValid) return null;

    const userId = authorizedPubkey.userId;
    const issuerId = computeClientId(pubkey);

    // AWP Client uses "agent" type token to represent agent-level access
    const syntheticToken: Token = {
      pk: `token#awp_${userId}`,
      sk: "TOKEN",
      type: "agent",
      userId,
      name: "AWP Client",
      createdAt: Date.now(),
      expiresAt: Date.now() + 3600000,
    };

    const auth: AuthContext = {
      token: syntheticToken,
      userId,
      realm: `usr_${userId}`,
      canRead: true,
      canWrite: true,
      canIssueTicket: true,
      identityType: "awp",
      issuerId,
      isAgent: true,
    };

    return applyUserRole(auth);
  };

  return async (c, next) => {
    // Check for AWP signed request first
    const awpPubkey = c.req.header(AWP_AUTH_HEADERS.pubkey);
    if (awpPubkey) {
      const timestamp = c.req.header(AWP_AUTH_HEADERS.timestamp);
      const signature = c.req.header(AWP_AUTH_HEADERS.signature);

      if (timestamp && signature) {
        const body = await c.req.text();
        const auth = await authenticateAwp(
          awpPubkey,
          timestamp,
          signature,
          c.req.method,
          c.req.path,
          body
        );

        if (auth) {
          c.set("auth", auth);
          return next();
        }
      }
    }

    // Try Bearer token auth
    const authHeader = c.req.header("Authorization");
    if (authHeader) {
      const auth = await authenticateBearer(authHeader);
      if (auth) {
        // Check for expired/revoked ticket marker
        if ((auth as unknown as { expired?: boolean }).expired) {
          return c.json({ error: "gone", message: "Ticket expired or revoked" }, 410);
        }
        c.set("auth", auth);
        return next();
      }
    }

    return c.json({ error: "Unauthorized" }, 401);
  };
};

/**
 * Optional auth middleware - doesn't reject if no auth
 */
export const createOptionalAuthMiddleware = (deps: AuthMiddlewareDeps): MiddlewareHandler<Env> => {
  const authMiddleware = createAuthMiddleware(deps);

  return async (c, next) => {
    // Check if there's any auth header
    const authHeader = c.req.header("Authorization");
    const awpPubkey = c.req.header(AWP_AUTH_HEADERS.pubkey);

    if (!authHeader && !awpPubkey) {
      return next();
    }

    // Try to authenticate but don't fail if it doesn't work
    try {
      await authMiddleware(c, next);
    } catch {
      return next();
    }
  };
};
