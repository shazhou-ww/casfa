/**
 * Branch API: create (root child or sub-branch), list, revoke, complete.
 * Branch token = base64url(branchId); auth middleware accepts it.
 */
import type { Context } from "hono";
import type { Env } from "../types.ts";
import type { RootResolverDeps } from "../services/root-resolver.ts";
import { resolvePath } from "../services/root-resolver.ts";
import type { Delegate } from "@casfa/realm";
import type { ServerConfig } from "../config.ts";

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

function hasBranchManage(auth: NonNullable<Env["Variables"]["auth"]>): boolean {
  if (auth.type === "user") return true;
  if (auth.type === "delegate") return auth.permissions.includes("branch_manage");
  return false;
}

export type BranchesControllerDeps = RootResolverDeps & {
  config: ServerConfig;
};

async function parseBody<T>(c: Context<Env>): Promise<T> {
  return c.req.json<T>().catch(() => ({} as T));
}

export function createBranchesController(deps: BranchesControllerDeps) {
  const maxTtlMs = deps.config.auth.maxBranchTtlMs ?? 3600_000;

  return {
    async create(c: Context<Env>) {
      const auth = c.get("auth");
      if (!auth) {
        return c.json({ error: "FORBIDDEN", message: "Auth required" }, 403);
      }
      try {
        const body = await parseBody<{ mountPath: string; ttl?: number; parentBranchId?: string }>(c);
        const mountPath = typeof body.mountPath === "string" ? body.mountPath.trim().replace(/^\/+|\/+$/g, "") : "";
        if (!mountPath) {
          return c.json({ error: "BAD_REQUEST", message: "mountPath required" }, 400);
        }
        const ttlMs = typeof body.ttl === "number" && body.ttl > 0 ? Math.min(body.ttl, maxTtlMs) : undefined;
        const parentBranchId = typeof body.parentBranchId === "string" ? body.parentBranchId.trim() || undefined : undefined;

        const realmId = auth.type === "user" ? auth.userId : auth.realmId;

        if (!parentBranchId) {
          if (!hasBranchManage(auth)) {
            return c.json({ error: "FORBIDDEN", message: "branch_manage or user required" }, 403);
          }
          const rootFacade = await deps.realm.getRootDelegate(realmId, {});
          const childFacade = await rootFacade.createChildDelegate(mountPath, { ttl: ttlMs });
          const branchId = childFacade.delegateId;
          const expiresAt = childFacade.lifetime === "limited" ? childFacade.expiresAt : undefined;
          return c.json(
            {
              branchId,
              accessToken: base64urlEncode(branchId),
              ...(expiresAt != null && { expiresAt }),
            },
            201
          );
        }

        if (auth.type !== "worker" || auth.branchId !== parentBranchId) {
          return c.json({ error: "FORBIDDEN", message: "Must be worker of parent branch" }, 403);
        }
        const parentDelegate = await deps.delegateStore.getDelegate(parentBranchId);
        if (!parentDelegate) {
          return c.json({ error: "NOT_FOUND", message: "Parent branch not found" }, 404);
        }
        const parentRootKey = await deps.delegateStore.getRoot(parentBranchId);
        if (parentRootKey === null) {
          return c.json({ error: "NOT_FOUND", message: "Parent branch has no root" }, 404);
        }
        const childRootKey = await resolvePath(deps.cas, parentRootKey, mountPath);
        if (childRootKey === null) {
          return c.json({ error: "BAD_REQUEST", message: "mountPath does not resolve under parent root" }, 400);
        }
        const childId = crypto.randomUUID();
        const now = Date.now();
        const tokenStr = base64urlEncode(childId);
        const accessTokenHash = await sha256Hex(tokenStr);
        let childDelegate: Delegate;
        let expiresAt: number | undefined;
        if (ttlMs !== undefined && ttlMs > 0) {
          expiresAt = now + ttlMs;
          childDelegate = {
            lifetime: "limited",
            delegateId: childId,
            realmId: parentDelegate.realmId,
            parentId: parentBranchId,
            mountPath,
            accessTokenHash,
            expiresAt,
          };
        } else {
          const refreshHash = await sha256Hex(crypto.randomUUID());
          childDelegate = {
            lifetime: "unlimited",
            delegateId: childId,
            realmId: parentDelegate.realmId,
            parentId: parentBranchId,
            mountPath,
            accessTokenHash,
            refreshTokenHash: refreshHash,
            accessExpiresAt: now + 3600_000,
          };
        }
        await deps.delegateStore.insertDelegate(childDelegate);
        await deps.delegateStore.setRoot(childId, childRootKey);
        return c.json(
          {
            branchId: childId,
            accessToken: tokenStr,
            ...(expiresAt != null && { expiresAt }),
          },
          201
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : "Create branch failed";
        if (message.includes("path does not resolve") || message.includes("InvalidPath")) {
          return c.json({ error: "BAD_REQUEST", message }, 400);
        }
        throw err;
      }
    },

    async list(c: Context<Env>) {
      const auth = c.get("auth");
      if (!auth) return c.json({ error: "FORBIDDEN", message: "Auth required" }, 403);
      if (auth.type === "worker") {
        const delegate = await deps.delegateStore.getDelegate(auth.branchId);
        if (!delegate) return c.json({ error: "NOT_FOUND", message: "Branch not found" }, 404);
        return c.json({
          branches: [
            {
              branchId: delegate.delegateId,
              mountPath: delegate.mountPath,
              parentId: delegate.parentId,
              expiresAt: delegate.lifetime === "limited" ? delegate.expiresAt : undefined,
            },
          ],
        }, 200);
      }
      const realmId = auth.type === "user" ? auth.userId : auth.realmId;
      const delegates = await deps.delegateStore.listDelegates(realmId);
      const branches = delegates.map((d) => ({
        branchId: d.delegateId,
        mountPath: d.mountPath,
        parentId: d.parentId,
        expiresAt: d.lifetime === "limited" ? d.expiresAt : undefined,
      }));
      return c.json({ branches }, 200);
    },

    async revoke(c: Context<Env>) {
      const auth = c.get("auth");
      if (!auth || !hasBranchManage(auth)) {
        return c.json({ error: "FORBIDDEN", message: "branch_manage or user required" }, 403);
      }
      const branchId = c.req.param("branchId");
      if (!branchId) {
        return c.json({ error: "BAD_REQUEST", message: "branchId required" }, 400);
      }
      const realmId = auth.type === "user" ? auth.userId : auth.realmId;
      const delegate = await deps.delegateStore.getDelegate(branchId);
      if (!delegate || delegate.realmId !== realmId) {
        return c.json({ error: "NOT_FOUND", message: "Branch not found" }, 404);
      }
      await deps.delegateStore.removeDelegate(branchId);
      return c.json({ revoked: branchId }, 200);
    },

    async complete(c: Context<Env>) {
      const auth = c.get("auth");
      if (!auth || auth.type !== "worker") {
        return c.json({ error: "FORBIDDEN", message: "Worker (branch token) required" }, 403);
      }
      const paramId = c.req.param("branchId");
      const branchId = paramId === "me" ? auth.branchId : paramId;
      if (branchId !== auth.branchId) {
        return c.json({ error: "FORBIDDEN", message: "Can only complete own branch" }, 403);
      }
      const delegate = await deps.delegateStore.getDelegate(branchId);
      if (!delegate) {
        return c.json({ error: "NOT_FOUND", message: "Branch not found" }, 404);
      }
      const parentId = delegate.parentId;
      if (parentId === null) {
        return c.json({ error: "BAD_REQUEST", message: "Cannot complete root branch" }, 400);
      }
      const childRootKey = await deps.delegateStore.getRoot(branchId);
      if (childRootKey === null) {
        return c.json({ error: "NOT_FOUND", message: "Branch has no root" }, 404);
      }
      const parentRootKey = await deps.delegateStore.getRoot(parentId);
      if (parentRootKey === null) {
        return c.json({ error: "NOT_FOUND", message: "Parent has no root" }, 404);
      }
      const { replaceSubtreeAtPath } = await import("../services/tree-mutations.ts");
      const segments = delegate.mountPath.split("/").filter((s) => s.length > 0);
      if (segments.length === 0) {
        return c.json({ error: "BAD_REQUEST", message: "Invalid mount path" }, 400);
      }
      const newParentRootKey = await replaceSubtreeAtPath(
        deps.cas,
        deps.key,
        parentRootKey,
        segments,
        childRootKey
      );
      await deps.delegateStore.setRoot(parentId, newParentRootKey);
      await deps.delegateStore.setClosed(branchId);
      return c.json({ completed: branchId }, 200);
    },
  };
}
