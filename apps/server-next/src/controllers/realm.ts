/**
 * Realm info, usage, and gc.
 */
import type { Context } from "hono";
import type { Env } from "../types.ts";
import type { RootResolverDeps } from "../services/root-resolver.ts";

function hasRealmAccess(auth: NonNullable<Env["Variables"]["auth"]>): boolean {
  if (auth.type === "user") return true;
  if (auth.type === "delegate") return true;
  return false;
}

export type RealmControllerDeps = RootResolverDeps;

export function createRealmController(deps: RealmControllerDeps) {
  return {
    async info(c: Context<Env>) {
      const auth = c.get("auth");
      if (!auth || !hasRealmAccess(auth)) {
        return c.json({ error: "FORBIDDEN", message: "Realm access required" }, 403);
      }
      const realmId = auth.type === "user" ? auth.userId : auth.realmId;
      const info = await deps.realm.info(realmId);
      return c.json(
        {
          realmId,
          lastGcTime: info.lastGcTime,
          nodeCount: info.nodeCount,
          totalBytes: info.totalBytes,
          delegateCount: info.delegateCount,
        },
        200
      );
    },

    async usage(c: Context<Env>) {
      const auth = c.get("auth");
      if (!auth || !hasRealmAccess(auth)) {
        return c.json({ error: "FORBIDDEN", message: "Realm access required" }, 403);
      }
      const realmId = auth.type === "user" ? auth.userId : auth.realmId;
      const info = await deps.realm.info(realmId);
      return c.json(
        {
          nodeCount: info.nodeCount,
          totalBytes: info.totalBytes,
        },
        200
      );
    },

    async gc(c: Context<Env>) {
      const auth = c.get("auth");
      if (!auth || !hasRealmAccess(auth)) {
        return c.json({ error: "FORBIDDEN", message: "Realm access required" }, 403);
      }
      const realmId = auth.type === "user" ? auth.userId : auth.realmId;
      try {
        const body = (await c.req.json<{ cutOffTime?: number }>().catch(() => ({}))) as {
          cutOffTime?: number;
        };
        const cutOffTime =
          typeof body.cutOffTime === "number" ? body.cutOffTime : Date.now() - 86400_000;
        await deps.realm.gc(realmId, cutOffTime);
        return c.json({ gc: true, cutOffTime }, 200);
      } catch (err) {
        throw err;
      }
    },
  };
}
