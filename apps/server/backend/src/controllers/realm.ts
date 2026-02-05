/**
 * Realm controller
 */

import type { Context } from "hono";
import type { ServerConfig } from "../config.ts";
import type { UsageDb } from "../db/usage.ts";
import type { AccessTokenAuthContext, Env } from "../types.ts";

export type RealmController = {
  getInfo: (c: Context<Env>) => Response;
  getUsage: (c: Context<Env>) => Promise<Response>;
};

type RealmControllerDeps = {
  usageDb: UsageDb;
  serverConfig: ServerConfig;
};

export const createRealmController = (deps: RealmControllerDeps): RealmController => {
  const { usageDb, serverConfig } = deps;

  return {
    getInfo: (c) => {
      const auth = c.get("auth") as AccessTokenAuthContext;
      const realmId = c.req.param("realmId");

      return c.json({
        realm: realmId,
        scope: undefined, // TODO: Return actual scope from token
        commit: auth.canUpload ? {} : undefined,
        nodeLimit: serverConfig.nodeLimit,
        maxNameBytes: serverConfig.maxNameBytes,
      });
    },

    getUsage: async (c) => {
      const realmId = c.req.param("realmId");
      const usage = await usageDb.getUsage(realmId);

      return c.json({
        realm: usage.realm,
        physicalBytes: usage.physicalBytes,
        logicalBytes: usage.logicalBytes,
        nodeCount: usage.nodeCount,
        quotaLimit: usage.quotaLimit,
        updatedAt: usage.updatedAt ?? Date.now(),
      });
    },
  };
};
