/**
 * Depots controller
 *
 * Handles depot CRUD operations.
 * Ticket authentication is not allowed for depot operations.
 */

import { EMPTY_DICT_KEY } from "@casfa/core";
import { CreateDepotSchema, DepotCommitSchema, UpdateDepotSchema } from "@casfa/protocol";
import type { StorageProvider } from "@casfa/storage-core";
import type { Context } from "hono";
import {
  DEFAULT_MAX_HISTORY,
  type DepotsDb,
  MAIN_DEPOT_TITLE,
  SYSTEM_MAX_HISTORY,
} from "../db/depots.ts";
import type { Env } from "../types.ts";

// ============================================================================
// Types
// ============================================================================

export type DepotsController = {
  list: (c: Context<Env>) => Promise<Response>;
  create: (c: Context<Env>) => Promise<Response>;
  get: (c: Context<Env>) => Promise<Response>;
  update: (c: Context<Env>) => Promise<Response>;
  commit: (c: Context<Env>) => Promise<Response>;
  delete: (c: Context<Env>) => Promise<Response>;
};

type DepotsControllerDeps = {
  depotsDb: DepotsDb;
  storage: StorageProvider;
};

// ============================================================================
// Helpers
// ============================================================================

const formatDepotId = (depotId: string): string =>
  depotId.startsWith("depot:") ? depotId : `depot:${depotId}`;

const formatRoot = (root: string): string => (root.startsWith("node:") ? root : `node:${root}`);

const formatDepotResponse = (depot: {
  depotId: string;
  title: string;
  root: string;
  maxHistory: number;
  history: string[];
  createdAt: number;
  updatedAt: number;
}) => ({
  depotId: formatDepotId(depot.depotId),
  title: depot.title,
  root: formatRoot(depot.root),
  maxHistory: depot.maxHistory,
  history: depot.history.map(formatRoot),
  createdAt: depot.createdAt,
  updatedAt: depot.updatedAt,
});

// ============================================================================
// Factory
// ============================================================================

export const createDepotsController = (deps: DepotsControllerDeps): DepotsController => {
  const { depotsDb, storage } = deps;

  const getRealm = (c: Context<Env>): string => {
    return c.req.param("realmId") ?? c.get("auth").realm;
  };

  const isTicketAuth = (c: Context<Env>): boolean => {
    return c.get("auth").identityType === "ticket";
  };

  return {
    list: async (c) => {
      // Tickets cannot access depots
      if (isTicketAuth(c)) {
        return c.json({ error: "Tickets cannot access depot operations" }, 403);
      }

      const realm = getRealm(c);
      const limit = Number.parseInt(c.req.query("limit") ?? "100", 10);
      const cursor = c.req.query("cursor");

      const result = await depotsDb.list(realm, { limit, startKey: cursor });

      return c.json({
        depots: result.depots.map(formatDepotResponse),
        nextCursor: result.nextKey,
        hasMore: result.hasMore,
      });
    },

    create: async (c) => {
      if (isTicketAuth(c)) {
        return c.json({ error: "Tickets cannot access depot operations" }, 403);
      }

      const realm = getRealm(c);
      const body = CreateDepotSchema.parse(await c.req.json());
      const { title, maxHistory = DEFAULT_MAX_HISTORY } = body;

      // Validate maxHistory (schema allows up to MAX_HISTORY_LIMIT, but system may have stricter limit)
      if (maxHistory > SYSTEM_MAX_HISTORY) {
        return c.json({ error: `maxHistory cannot exceed ${SYSTEM_MAX_HISTORY}` }, 400);
      }

      // Check title uniqueness
      if (title) {
        const existing = await depotsDb.getByTitle(realm, title);
        if (existing) {
          return c.json({ error: `Depot with title '${title}' already exists` }, 409);
        }
      }

      // Create depot with empty dict as initial root
      const depot = await depotsDb.create(realm, {
        title: title ?? `Depot ${Date.now()}`,
        root: EMPTY_DICT_KEY,
        maxHistory,
      });

      return c.json(formatDepotResponse(depot), 201);
    },

    get: async (c) => {
      if (isTicketAuth(c)) {
        return c.json({ error: "Tickets cannot access depot operations" }, 403);
      }

      const realm = getRealm(c);
      const depotId = decodeURIComponent(c.req.param("depotId"));

      const depot = await depotsDb.get(realm, depotId);
      if (!depot) {
        return c.json({ error: "Depot not found" }, 404);
      }

      return c.json(formatDepotResponse(depot));
    },

    update: async (c) => {
      if (isTicketAuth(c)) {
        return c.json({ error: "Tickets cannot access depot operations" }, 403);
      }

      const realm = getRealm(c);
      const depotId = decodeURIComponent(c.req.param("depotId"));
      const { title, maxHistory } = UpdateDepotSchema.parse(await c.req.json());

      // Validate maxHistory (schema allows up to MAX_HISTORY_LIMIT, but system may have stricter limit)
      if (maxHistory !== undefined && maxHistory > SYSTEM_MAX_HISTORY) {
        return c.json({ error: `maxHistory cannot exceed ${SYSTEM_MAX_HISTORY}` }, 400);
      }

      const depot = await depotsDb.update(realm, depotId, { title, maxHistory });
      if (!depot) {
        return c.json({ error: "Depot not found" }, 404);
      }

      return c.json(formatDepotResponse(depot));
    },

    commit: async (c) => {
      if (isTicketAuth(c)) {
        return c.json({ error: "Tickets cannot access depot operations" }, 403);
      }

      const realm = getRealm(c);
      const depotId = decodeURIComponent(c.req.param("depotId"));

      // First check if depot exists
      const existingDepot = await depotsDb.get(realm, depotId);
      if (!existingDepot) {
        return c.json({ error: "Depot not found" }, 404);
      }

      const { root: newRoot } = DepotCommitSchema.parse(await c.req.json());

      // Normalize root (remove node: prefix if present)
      const normalizedRoot = newRoot.startsWith("node:") ? newRoot.slice(5) : newRoot;

      // Check if new root exists in storage
      const exists = await storage.has(normalizedRoot);
      if (!exists) {
        return c.json({ error: "Root node does not exist" }, 400);
      }

      const depot = await depotsDb.commit(realm, depotId, normalizedRoot);
      if (!depot) {
        return c.json({ error: "Depot not found" }, 404);
      }

      return c.json(formatDepotResponse(depot));
    },

    delete: async (c) => {
      if (isTicketAuth(c)) {
        return c.json({ error: "Tickets cannot access depot operations" }, 403);
      }

      const realm = getRealm(c);
      const depotId = decodeURIComponent(c.req.param("depotId"));

      // Get depot first to check if it's main
      const depot = await depotsDb.get(realm, depotId);
      if (!depot) {
        return c.json({ error: "Depot not found" }, 404);
      }

      if (depot.title === MAIN_DEPOT_TITLE) {
        return c.json({ error: "Cannot delete the main depot" }, 403);
      }

      await depotsDb.delete(realm, depotId);

      return c.json({ success: true });
    },
  };
};
