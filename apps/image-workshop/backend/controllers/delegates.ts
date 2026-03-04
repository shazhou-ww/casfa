import { Hono } from "hono";
import type { Auth, DelegateGrantStore } from "../types/auth";
import {
  createDelegateAccessToken,
  generateDelegateId,
  generateRandomToken,
  sha256Hex,
} from "../utils/token";

type DelegatesControllerDeps = {
  grantStore: DelegateGrantStore;
};

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

function requireManageDelegates(auth: Auth | null): Auth {
  if (!auth) throw new Error("Unauthorized");
  if (auth.type === "user") return auth;
  if (auth.permissions.includes("manage_delegates")) return auth;
  throw new Error("Forbidden: manage_delegates required");
}

export function createDelegatesRoutes(deps: DelegatesControllerDeps) {
  const routes = new Hono();
  const { grantStore } = deps;

  routes.get("/api/delegates", async (c) => {
    const auth = requireManageDelegates(c.get("auth"));
    const grants = await grantStore.list(auth.userId);
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
    const body = await c.req.json<{
      clientName: string;
      permissions?: string[];
      ttl?: number;
    }>();

    const delegateId = generateDelegateId();
    const accessToken = createDelegateAccessToken(auth.userId, delegateId);
    const refreshToken = generateRandomToken();
    const now = Date.now();
    const ttl = body.ttl ?? DEFAULT_TTL_MS;
    const permissions = (body.permissions ?? ["use_mcp"]) as ("use_mcp" | "manage_delegates")[];

    await grantStore.insert({
      delegateId,
      userId: auth.userId,
      clientName: body.clientName,
      permissions,
      accessTokenHash: await sha256Hex(accessToken),
      refreshTokenHash: await sha256Hex(refreshToken),
      createdAt: now,
      expiresAt: now + ttl,
    });

    return c.json({
      delegateId,
      clientName: body.clientName,
      accessToken,
      refreshToken,
      permissions,
      expiresAt: now + ttl,
    });
  });

  routes.post("/api/delegates/:id/revoke", async (c) => {
    const auth = requireManageDelegates(c.get("auth"));
    const delegateId = c.req.param("id");
    const grant = await grantStore.get(delegateId);
    if (!grant || grant.userId !== auth.userId) {
      return c.json({ error: "not_found" }, 404);
    }
    await grantStore.remove(delegateId);
    return c.json({ ok: true });
  });

  return routes;
}
