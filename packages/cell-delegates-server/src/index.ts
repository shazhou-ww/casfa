/**
 * Delegate management routes: list, create, revoke.
 * Requires auth with manage_delegates (user or delegate with that permission).
 */
import type { DelegatePermission, OAuthServer } from "@casfa/cell-oauth";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

export type { DelegateAuth, DelegateGrant, DelegateGrantStore, DelegatePermission } from "./types.ts";
export { createDelegateAccessToken, decodeDelegateTokenPayload, generateDelegateId, generateRandomToken, sha256Hex, verifyCodeChallenge } from "./token.ts";

export type DelegatesEnv = {
  Variables: {
    auth?: { type: "user"; userId: string } | { type: "delegate"; realmId: string; permissions: string[] };
  };
};

export type CreateDelegatesRoutesDeps<E extends DelegatesEnv = DelegatesEnv> = {
  oauthServer: OAuthServer;
  /** Return the realm owner id (userId for user, realmId for delegate). */
  getUserId: (auth: E["Variables"]["auth"]) => string;
};

function requireManageDelegates(auth: DelegatesEnv["Variables"]["auth"]): NonNullable<DelegatesEnv["Variables"]["auth"]> {
  if (!auth) throw new HTTPException(401, { message: "Unauthorized" });
  if (auth.type === "user") return auth;
  if (auth.type === "delegate" && auth.permissions.includes("manage_delegates")) return auth;
  throw new HTTPException(403, { message: "Forbidden: manage_delegates required" });
}

export function createDelegatesRoutes<E extends DelegatesEnv>(deps: CreateDelegatesRoutesDeps<E>): Hono<E> {
  const routes = new Hono<E>();
  const { oauthServer, getUserId } = deps;

  routes.get("/api/delegates", async (c) => {
    const auth = requireManageDelegates(c.get("auth"));
    const userId = getUserId(auth);
    const grants = await oauthServer.listDelegates(userId);
    return c.json(
      grants.map((g) => ({
        delegateId: g.delegateId,
        clientName: g.clientName,
        permissions: g.permissions,
        createdAt: g.createdAt,
        expiresAt: g.expiresAt,
      }))
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
      permissions: (body.permissions ?? ["use_mcp"]) as DelegatePermission[],
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
