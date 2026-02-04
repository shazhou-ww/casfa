/**
 * Client authentication controller (P256 public key authentication)
 */

import { generateVerificationCode } from "@casfa/auth";
import { ClientCompleteSchema, ClientInitSchema } from "@casfa/protocol";
import type { Context } from "hono";
import type { ClientPendingDb } from "../db/client-pending";
import type { ClientPubkeysDb } from "../db/client-pubkeys";
import type { Env } from "../types.ts";
import { computeClientId } from "../util/client-id.ts";

export type AuthClientsController = {
  init: (c: Context) => Promise<Response>;
  get: (c: Context) => Promise<Response>;
  complete: (c: Context<Env>) => Promise<Response>;
  list: (c: Context<Env>) => Promise<Response>;
  revoke: (c: Context<Env>) => Promise<Response>;
};

type AuthClientsControllerDeps = {
  clientPendingDb: ClientPendingDb;
  clientPubkeysDb: ClientPubkeysDb;
};

export const createAuthClientsController = (
  deps: AuthClientsControllerDeps
): AuthClientsController => {
  const { clientPendingDb, clientPubkeysDb } = deps;

  return {
    /**
     * POST /api/auth/clients/init
     * Initialize client authentication flow
     */
    init: async (c) => {
      const { pubkey, clientName } = ClientInitSchema.parse(await c.req.json());
      const clientId = computeClientId(pubkey);
      const displayCode = generateVerificationCode();
      const now = Date.now();
      const expiresIn = 600; // 10 minutes

      await clientPendingDb.create({
        clientId,
        pubkey,
        clientName,
        displayCode,
        createdAt: now,
        expiresAt: now + expiresIn * 1000,
      });

      const origin = c.req.header("origin") ?? "";
      const authUrl = `${origin}/auth/client?id=${encodeURIComponent(clientId)}`;

      return c.json({
        clientId,
        authUrl,
        displayCode,
        expiresIn,
        pollInterval: 5,
      });
    },

    /**
     * GET /api/auth/clients/:clientId
     * Get client status (pending or authorized)
     */
    get: async (c) => {
      const clientId = c.req.param("clientId");

      // Check if already authorized
      const authorized = await clientPubkeysDb.getByClientId(clientId);
      if (authorized) {
        return c.json({
          status: "authorized",
          clientId,
          clientName: authorized.clientName,
          expiresAt: authorized.expiresAt,
        });
      }

      // Check if pending
      const pending = await clientPendingDb.getByClientId(clientId);
      if (!pending) {
        return c.json(
          {
            status: "not_found",
            error: "No pending or authorized client found",
          },
          404
        );
      }

      return c.json({
        status: "pending",
        clientId,
        expiresAt: pending.expiresAt,
      });
    },

    /**
     * POST /api/auth/clients/complete
     * Complete client authorization (called by authenticated user)
     */
    complete: async (c) => {
      const auth = c.get("auth");
      const { clientId, verificationCode } = ClientCompleteSchema.parse(await c.req.json());

      const pending = await clientPendingDb.getByClientId(clientId);
      if (!pending) {
        return c.json({ error: "Pending authorization not found" }, 400);
      }

      if (pending.displayCode !== verificationCode) {
        return c.json({ error: "Invalid verification code" }, 400);
      }

      const now = Date.now();
      const expiresAt = now + 30 * 24 * 60 * 60 * 1000; // 30 days

      await clientPubkeysDb.store({
        clientId,
        pubkey: pending.pubkey,
        userId: auth.userId,
        clientName: pending.clientName,
        createdAt: now,
        expiresAt,
      });

      await clientPendingDb.delete(clientId);

      return c.json({
        success: true,
        clientId,
        expiresAt,
      });
    },

    /**
     * GET /api/auth/clients
     * List authorized clients for current user
     */
    list: async (c) => {
      const auth = c.get("auth");
      const clients = await clientPubkeysDb.listByUser(auth.userId);

      return c.json({
        items: clients.map((client) => ({
          clientId: client.clientId,
          clientName: client.clientName,
          createdAt: client.createdAt,
          expiresAt: client.expiresAt,
        })),
      });
    },

    /**
     * DELETE /api/auth/clients/:clientId
     * Revoke an authorized client
     */
    revoke: async (c) => {
      const auth = c.get("auth");
      const clientId = c.req.param("clientId");

      const client = await clientPubkeysDb.getByClientId(clientId);
      if (!client || client.userId !== auth.userId) {
        return c.json({ error: "Client not found or access denied" }, 404);
      }

      await clientPubkeysDb.revokeByClientId(clientId);
      return c.json({ success: true });
    },
  };
};
