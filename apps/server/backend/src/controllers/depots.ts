/**
 * Depots controller
 *
 * Handles depot CRUD operations.
 * Requires Access Token with canManageDepot permission for create/update/delete.
 */

import { EMPTY_DICT_KEY, isWellKnownNode } from "@casfa/core";
import {
  CreateDepotSchema,
  DepotCommitSchema,
  nodeKeyToStorageKey,
  storageKeyToNodeKey,
  UpdateDepotSchema,
} from "@casfa/protocol";
import type { StorageProvider } from "@casfa/storage-core";
import type { Context } from "hono";
import { DEFAULT_MAX_HISTORY, DepotConflictError, type DepotsDb, SYSTEM_MAX_HISTORY } from "../db/depots.ts";
import type { OwnershipV2Db } from "../db/ownership-v2.ts";
import type { AccessTokenAuthContext, DepotHistoryEntry, Env } from "../types.ts";

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
  ownershipV2Db: OwnershipV2Db;
};

// ============================================================================
// Helpers
// ============================================================================

/** Format depot response for API output. IDs are now canonical (dpt_, nod_). */
const formatDepotResponse = (depot: {
  depotId: string;
  title: string;
  root: string;
  maxHistory: number;
  history: DepotHistoryEntry[];
  createdAt: number;
  updatedAt: number;
}) => ({
  depotId: depot.depotId,
  title: depot.title,
  root: depot.root,
  maxHistory: depot.maxHistory,
  history: depot.history,
  createdAt: depot.createdAt,
  updatedAt: depot.updatedAt,
});

// ============================================================================
// Factory
// ============================================================================

export const createDepotsController = (deps: DepotsControllerDeps): DepotsController => {
  const { depotsDb, storage, ownershipV2Db } = deps;

  const getRealm = (c: Context<Env>): string => {
    return c.req.param("realmId") ?? c.get("auth").realm;
  };

  return {
    list: async (c) => {
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
      // Permission check is done by middleware (canManageDepotMiddleware)
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

      // Create depot with empty dict as initial root (nod_ format)
      const depot = await depotsDb.create(realm, {
        name: title ?? `depot-${Date.now()}`,
        title: title ?? `Depot ${Date.now()}`,
        root: storageKeyToNodeKey(EMPTY_DICT_KEY),
        maxHistory,
      });

      return c.json(formatDepotResponse(depot), 201);
    },

    get: async (c) => {
      const realm = getRealm(c);
      const depotId = decodeURIComponent(c.req.param("depotId"));

      const depot = await depotsDb.get(realm, depotId);
      if (!depot) {
        return c.json({ error: "Depot not found" }, 404);
      }

      return c.json(formatDepotResponse(depot));
    },

    update: async (c) => {
      // Permission check is done by middleware (canManageDepotMiddleware)
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
      // Permission check is done by middleware (canUploadMiddleware)
      const auth = c.get("auth") as AccessTokenAuthContext;
      const realm = getRealm(c);
      const depotId = decodeURIComponent(c.req.param("depotId"));

      // First check if depot exists
      const existingDepot = await depotsDb.get(realm, depotId);
      if (!existingDepot) {
        return c.json({ error: "Depot not found" }, 404);
      }

      const { root: newRoot, expectedRoot } = DepotCommitSchema.parse(await c.req.json());

      // Convert node key to CB32 storage key for storage/ownership lookups
      const storageKey = nodeKeyToStorageKey(newRoot);

      // Well-known nodes (e.g. empty dict) are virtual & universally owned — skip all checks
      if (!isWellKnownNode(storageKey)) {
        // Check if new root exists in storage
        const exists = (await storage.get(storageKey)) !== null;
        if (!exists) {
          return c.json({ error: "Root node does not exist" }, 400);
        }

        // Ownership verification: root must be owned by current delegate's chain
        const delegateChain = auth.issuerChain;
        let rootAuthorized = false;
        for (const id of delegateChain) {
          if (await ownershipV2Db.hasOwnership(storageKey, id)) {
            rootAuthorized = true;
            break;
          }
        }
        if (!rootAuthorized) {
          return c.json(
            {
              error: "ROOT_NOT_AUTHORIZED",
              message: "Not authorized to set this node as depot root. Upload the node first.",
            },
            403
          );
        }
      }

      // Store old root for response
      const previousRoot = existingDepot.root ?? null;

      try {
        // Store root as node key format (node:XXXX) in the depot
        const depot = await depotsDb.commit(realm, depotId, newRoot, expectedRoot);
        if (!depot) {
          return c.json({ error: "Depot not found" }, 404);
        }

        return c.json({
          ...formatDepotResponse(depot),
          previousRoot,
        });
      } catch (err) {
        if (err instanceof DepotConflictError) {
          return c.json(
            {
              error: {
                code: "CONFLICT",
                message: "Depot root has changed since expectedRoot",
                currentRoot: err.currentRoot,
                expectedRoot: err.expectedRoot,
              },
            },
            409
          );
        }
        throw err;
      }
    },

    delete: async (c) => {
      // Permission check is done by middleware (canManageDepotMiddleware)
      const realm = getRealm(c);
      const depotId = decodeURIComponent(c.req.param("depotId"));

      const depot = await depotsDb.get(realm, depotId);
      if (!depot) {
        return c.json({ error: "Depot not found" }, 404);
      }

      await depotsDb.delete(realm, depotId);

      return c.json({ success: true });
    },
  };
};
