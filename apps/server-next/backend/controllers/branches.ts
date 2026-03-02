/**
 * Branch API: create (root child or sub-branch), list, revoke, complete.
 * Branch token = base64url(branchId); auth middleware accepts it.
 */
import type { Context } from "hono";
import type { Env } from "../types.ts";
import type { RootResolverDeps } from "../services/root-resolver.ts";
import { resolvePath } from "../services/root-resolver.ts";
import type { Branch } from "../types/branch.ts";
import type { ServerConfig } from "../config.ts";

function base64urlEncode(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
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
  const defaultTtlMs = 3600_000;

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
        const ttlMs = typeof body.ttl === "number" && body.ttl > 0 ? Math.min(body.ttl, maxTtlMs) : defaultTtlMs;
        const parentBranchId = typeof body.parentBranchId === "string" ? body.parentBranchId.trim() || undefined : undefined;

        const realmId = auth.type === "user" ? auth.userId : auth.realmId;

        if (!parentBranchId) {
          if (!hasBranchManage(auth)) {
            return c.json({ error: "FORBIDDEN", message: "branch_manage or user required" }, 403);
          }
          const rootKey = await deps.branchStore.getRealmRoot(realmId);
          if (rootKey === null) {
            return c.json(
              { error: "NOT_FOUND", message: "Realm not initialized. Open your profile or realm first." },
              404
            );
          }
          const rootRecord = await deps.branchStore.getRealmRootRecord(realmId);
          if (!rootRecord) throw new Error("Realm root record not found");
          const childRootKey = await resolvePath(deps.cas, rootKey, mountPath);
          if (childRootKey === null) {
            return c.json({ error: "BAD_REQUEST", message: "mountPath does not resolve under realm root" }, 400);
          }
          const branchId = crypto.randomUUID();
          const now = Date.now();
          const expiresAt = now + ttlMs;
          await deps.branchStore.insertBranch({
            branchId,
            realmId,
            parentId: rootRecord.branchId,
            mountPath,
            expiresAt,
          });
          await deps.branchStore.setBranchRoot(branchId, childRootKey);
          return c.json(
            {
              branchId,
              accessToken: base64urlEncode(branchId),
              expiresAt,
            },
            201
          );
        }

        if (auth.type !== "worker" || auth.branchId !== parentBranchId) {
          return c.json({ error: "FORBIDDEN", message: "Must be worker of parent branch" }, 403);
        }
        const parentBranch = await deps.branchStore.getBranch(parentBranchId);
        if (!parentBranch) {
          return c.json({ error: "NOT_FOUND", message: "Parent branch not found" }, 404);
        }
        const parentRootKey = await deps.branchStore.getBranchRoot(parentBranchId);
        if (parentRootKey === null) {
          return c.json({ error: "NOT_FOUND", message: "Parent branch has no root" }, 404);
        }
        const childRootKey = await resolvePath(deps.cas, parentRootKey, mountPath);
        if (childRootKey === null) {
          return c.json({ error: "BAD_REQUEST", message: "mountPath does not resolve under parent root" }, 400);
        }
        const childId = crypto.randomUUID();
        const now = Date.now();
        const expiresAt = now + ttlMs;
        await deps.branchStore.insertBranch({
          branchId: childId,
          realmId: parentBranch.realmId,
          parentId: parentBranchId,
          mountPath,
          expiresAt,
        });
        await deps.branchStore.setBranchRoot(childId, childRootKey);
        return c.json(
          {
            branchId: childId,
            accessToken: base64urlEncode(childId),
            expiresAt,
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
        const branch = await deps.branchStore.getBranch(auth.branchId);
        if (!branch) return c.json({ error: "NOT_FOUND", message: "Branch not found" }, 404);
        return c.json({
          branches: [
            {
              branchId: branch.branchId,
              mountPath: branch.mountPath,
              parentId: branch.parentId,
              expiresAt: branch.expiresAt,
            },
          ],
        }, 200);
      }
      const realmId = auth.type === "user" ? auth.userId : auth.realmId;
      const branches = await deps.branchStore.listBranches(realmId);
      return c.json({
        branches: branches.map((b: Branch) => ({
          branchId: b.branchId,
          mountPath: b.mountPath,
          parentId: b.parentId,
          expiresAt: b.expiresAt,
        })),
      }, 200);
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
      const branch = await deps.branchStore.getBranch(branchId);
      if (!branch || branch.realmId !== realmId) {
        return c.json({ error: "NOT_FOUND", message: "Branch not found" }, 404);
      }
      await deps.branchStore.removeBranch(branchId);
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
      const branch = await deps.branchStore.getBranch(branchId);
      if (!branch) {
        return c.json({ error: "NOT_FOUND", message: "Branch not found" }, 404);
      }
      const parentId = branch.parentId;
      if (parentId === null) {
        return c.json({ error: "BAD_REQUEST", message: "Cannot complete root branch" }, 400);
      }
      const childRootKey = await deps.branchStore.getBranchRoot(branchId);
      if (childRootKey === null) {
        return c.json({ error: "NOT_FOUND", message: "Branch has no root" }, 404);
      }
      const realmId = branch.realmId;
      const rootRecord = await deps.branchStore.getRealmRootRecord(realmId);
      const isParentRoot = rootRecord !== null && rootRecord.branchId === parentId;
      const parentRootKey = isParentRoot
        ? await deps.branchStore.getRealmRoot(realmId)
        : await deps.branchStore.getBranchRoot(parentId);
      if (parentRootKey === null) {
        return c.json({ error: "NOT_FOUND", message: "Parent has no root" }, 404);
      }
      const { replaceSubtreeAtPath } = await import("../services/tree-mutations.ts");
      const segments = branch.mountPath.split("/").filter((s: string) => s.length > 0);
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
      if (isParentRoot) {
        await deps.branchStore.setRealmRoot(realmId, newParentRootKey);
      } else {
        await deps.branchStore.setBranchRoot(parentId, newParentRootKey);
      }
      await deps.branchStore.removeBranch(branchId);
      return c.json({ completed: branchId }, 200);
    },
  };
}
