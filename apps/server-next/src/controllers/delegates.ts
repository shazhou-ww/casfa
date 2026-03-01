/**
 * Delegate (long-term auth) management: list, revoke, assign.
 * Only user (or delegate_manage) can access.
 */
import type { Context } from "hono";
import type { Env } from "../types.ts";
import type { DelegateGrantStore } from "../db/delegate-grants.ts";

function hasDelegateManage(auth: NonNullable<Env["Variables"]["auth"]>): boolean {
  if (auth.type === "user") return true;
  if (auth.type === "delegate") return auth.permissions.includes("delegate_manage");
  return false;
}

export type DelegatesControllerDeps = {
  delegateGrantStore: DelegateGrantStore;
};

async function parseBody<T>(c: Context<Env>): Promise<T> {
  return c.req.json<T>().catch(() => ({} as T));
}

function base64urlEncode(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Minimal JWT-like string for delegate access token (header.payload.sig); payload has sub, client_id?, exp. */
function makeDelegateJwt(payload: { sub: string; client_id?: string; exp?: number }): string {
  const header = base64urlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payloadB64 = base64urlEncode(JSON.stringify(payload));
  return `${header}.${payloadB64}.sig`;
}

export function createDelegatesController(deps: DelegatesControllerDeps) {
  return {
    async list(c: Context<Env>) {
      const auth = c.get("auth");
      if (!auth || !hasDelegateManage(auth)) {
        return c.json({ error: "FORBIDDEN", message: "delegate_manage required" }, 403);
      }
      const realmId = auth.type === "user" ? auth.userId : auth.realmId;
      const grants = await deps.delegateGrantStore.list(realmId);
      const list = grants.map((g) => ({
        delegateId: g.delegateId,
        clientId: g.clientId,
        permissions: g.permissions,
        createdAt: g.createdAt,
        expiresAt: g.expiresAt,
      }));
      return c.json({ delegates: list }, 200);
    },

    async revoke(c: Context<Env>) {
      const auth = c.get("auth");
      if (!auth || !hasDelegateManage(auth)) {
        return c.json({ error: "FORBIDDEN", message: "delegate_manage required" }, 403);
      }
      const delegateId = c.req.param("delegateId");
      if (!delegateId) {
        return c.json({ error: "BAD_REQUEST", message: "delegateId required" }, 400);
      }
      const realmId = auth.type === "user" ? auth.userId : auth.realmId;
      const grant = await deps.delegateGrantStore.get(delegateId);
      if (!grant || grant.realmId !== realmId) {
        return c.json({ error: "NOT_FOUND", message: "Delegate not found" }, 404);
      }
      await deps.delegateGrantStore.remove(delegateId);
      return c.json({ revoked: delegateId }, 200);
    },

    async assign(c: Context<Env>) {
      const auth = c.get("auth");
      if (!auth || !hasDelegateManage(auth)) {
        return c.json({ error: "FORBIDDEN", message: "delegate_manage required" }, 403);
      }
      const realmId = auth.type === "user" ? auth.userId : auth.realmId;
      try {
        const body = await parseBody<{ ttl?: number; client_id?: string }>(c);
        const ttlMs = typeof body.ttl === "number" && body.ttl > 0 ? body.ttl : null;
        const clientId = typeof body.client_id === "string" && body.client_id.trim()
          ? body.client_id.trim()
          : crypto.randomUUID();
        const delegateId = crypto.randomUUID();
        const now = Date.now();
        const expiresAt = ttlMs != null ? now + ttlMs : null;
        const payload: { sub: string; client_id: string; exp?: number } = {
          sub: realmId,
          client_id: clientId,
          ...(expiresAt != null && { exp: Math.floor(expiresAt / 1000) }),
        };
        const accessToken = makeDelegateJwt(payload);
        const accessTokenHash = await sha256Hex(accessToken);
        await deps.delegateGrantStore.insert({
          delegateId,
          realmId,
          clientId,
          accessTokenHash,
          refreshTokenHash: null,
          permissions: ["file_read", "file_write", "branch_manage"],
          createdAt: now,
          expiresAt,
        });
        return c.json(
          {
            delegateId,
            accessToken,
            clientId,
            ...(expiresAt != null && { expiresAt }),
          },
          201
        );
      } catch (err) {
        throw err;
      }
    },
  };
}
