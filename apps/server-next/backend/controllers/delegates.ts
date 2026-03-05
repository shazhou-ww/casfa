/**
 * Delegate management: list, create, revoke.
 * Uses @casfa/cell-oauth OAuthServer; requires user or delegate with manage_delegates.
 */
import type { OAuthServer } from "@casfa/cell-oauth";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { Env } from "../types.ts";

type DelegatesControllerDeps = {
  oauthServer: OAuthServer;
};

function requireManageDelegates(auth: Env["Variables"]["auth"]): NonNullable<Env["Variables"]["auth"]> {
  if (!auth) throw new HTTPException(401, { message: "Unauthorized" });
  if (auth.type === "user") return auth;
  if (auth.type === "delegate" && auth.permissions.includes("manage_delegates")) return auth;
  throw new HTTPException(403, { message: "Forbidden: manage_delegates required" });
}

function getUserId(auth: NonNullable<Env["Variables"]["auth"]>): string {
  return auth.type === "user" ? auth.userId : auth.realmId;
}

export function createDelegatesRoutes(deps: DelegatesControllerDeps) {
  const routes = new Hono<Env>();
  const { oauthServer } = deps;

  routes.get("/api/delegates", async (c) => {
    const auth = requireManageDelegates(c.get("auth"));
    const grants = await oauthServer.listDelegates(getUserId(auth));
    return c.json(
      grants.map((g) => ({
        delegateId: g.delegateId,
        clientName: g.clientName,
        permissions: g.permissions,
        createdAt: g.createdAt,
        expiresAt: g.expiresAt,
      })),
    );
  });

  routes.post("/api/delegates", async (c) => {
    const auth = requireManageDelegates(c.get("auth"));
    const body = (await c.req.json()) as {
      clientName: string;
      permissions?: string[];
    };

    const result = await oauthServer.createDelegate({
      userId: getUserId(auth),
      clientName: body.clientName,
      permissions: (body.permissions ?? ["use_mcp"]) as ("use_mcp" | "manage_delegates")[],
    });

    return c.json({
      delegateId: result.grant.delegateId,
      clientName: result.grant.clientName,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      permissions: result.grant.permissions,
      expiresAt: result.grant.expiresAt,
    });
  });

  routes.post("/api/delegates/:id/revoke", async (c) => {
    const auth = requireManageDelegates(c.get("auth"));
    const delegateId = c.req.param("id");
    const grants = await oauthServer.listDelegates(getUserId(auth));
    const grant = grants.find((g) => g.delegateId === delegateId);
    if (!grant) return c.json({ error: "not_found" }, 404);
    await oauthServer.revokeDelegate(delegateId);
    return c.json({ ok: true });
  });

  return routes;
}
