import { createDelegate, listDelegates, revokeDelegate } from "@casfa/cell-delegates-server";
import type { DelegateGrantStore, DelegatePermission } from "@casfa/cell-delegates-server";
import type { Context } from "hono";
import type { Env } from "../types.ts";

type DelegatesControllerDeps = {
  grantStore: DelegateGrantStore;
};

function hasManageDelegates(auth: NonNullable<Env["Variables"]["auth"]>): boolean {
  if (auth.type === "user") return true;
  if (auth.type === "delegate") return auth.permissions.includes("manage_delegates");
  return false;
}

function getRealmId(auth: NonNullable<Env["Variables"]["auth"]>): string {
  return auth.type === "user" ? auth.userId : auth.realmId;
}

export function createDelegatesController(deps: DelegatesControllerDeps) {
  return {
    async list(c: Context<Env>) {
      const auth = c.get("auth");
      if (!auth || !hasManageDelegates(auth)) {
        return c.json({ error: "FORBIDDEN", message: "manage_delegates or user required" }, 403);
      }
      const realmId = getRealmId(auth);
      const grants = await listDelegates(deps.grantStore, realmId);
      return c.json(
        grants.map((g) => ({
          delegateId: g.delegateId,
          clientName: g.clientName,
          permissions: g.permissions,
          createdAt: g.createdAt,
          expiresAt: g.expiresAt,
        })),
        200
      );
    },

    async create(c: Context<Env>) {
      const auth = c.get("auth");
      if (!auth || !hasManageDelegates(auth)) {
        return c.json({ error: "FORBIDDEN", message: "manage_delegates or user required" }, 403);
      }
      let body: { clientName?: string; permissions?: string[] };
      try {
        body = (await c.req.json()) as { clientName?: string; permissions?: string[] };
      } catch {
        return c.json({ error: "BAD_REQUEST", message: "Invalid JSON body" }, 400);
      }
      const realmId = getRealmId(auth);
      const result = await createDelegate(deps.grantStore, {
        userId: realmId,
        clientName: body.clientName?.trim() || "Delegate",
        permissions: (body.permissions ?? ["use_mcp"]) as DelegatePermission[],
      });
      return c.json(
        {
          delegateId: result.grant.delegateId,
          clientName: result.grant.clientName,
          accessToken: result.accessToken,
          refreshToken: result.refreshToken,
          permissions: result.grant.permissions,
          expiresAt: result.grant.expiresAt,
        },
        201
      );
    },

    async revoke(c: Context<Env>) {
      const auth = c.get("auth");
      if (!auth || !hasManageDelegates(auth)) {
        return c.json({ error: "FORBIDDEN", message: "manage_delegates or user required" }, 403);
      }
      const delegateId = c.req.param("delegateId");
      if (!delegateId) {
        return c.json({ error: "BAD_REQUEST", message: "delegateId required" }, 400);
      }
      const realmId = getRealmId(auth);
      const grants = await listDelegates(deps.grantStore, realmId);
      const exists = grants.some((g) => g.delegateId === delegateId);
      if (!exists) {
        return c.json({ ok: true }, 200);
      }
      await revokeDelegate(deps.grantStore, delegateId);
      return c.json({ ok: true }, 200);
    },
  };
}
