/**
 * Branch API: create (root child or sub-branch), list, revoke, complete.
 * Branch token = base64url(branchId); auth middleware accepts it.
 */
import type { Context } from "hono";
import type { ServerConfig } from "../config.ts";
import type { RootResolverDeps } from "../services/root-resolver.ts";
import { ensureEmptyRoot, resolvePath } from "../services/root-resolver.ts";
import type { Branch } from "../types/branch.ts";
import type { TransferSpec } from "../types/transfer.ts";
import type { Env } from "../types.ts";
import { encodeCrockfordBase32 } from "../utils/crockford-base32.ts";
import { executeTransfer, validateTransferSpec } from "../services/transfer-paths.ts";

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
  return c.req.json<T>().catch(() => ({}) as T);
}

export function createBranchesController(deps: BranchesControllerDeps) {
  const maxTtlMs = deps.config.auth.maxBranchTtlMs ?? 600_000;
  const defaultTtlMs = 600_000;

  function generateVerification(expiresAt: number): string {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return encodeCrockfordBase32(bytes);
  }

  function buildCreateResponse(
    branchId: string,
    verification: string,
    expiresAt: number
  ): Record<string, unknown> {
    const body: Record<string, unknown> = {
      branchId,
      accessToken: base64urlEncode(branchId),
      expiresAt,
    };
    const base = deps.config.baseUrl?.replace(/\/$/, "");
    if (base) {
      body.accessUrlPrefix = `${base}/branch/${branchId}/${verification}`;
    }
    return body;
  }

  return {
    async create(c: Context<Env>) {
      const auth = c.get("auth");
      if (!auth) {
        return c.json({ error: "FORBIDDEN", message: "Auth required" }, 403);
      }
      try {
        const body = await parseBody<{
          mountPath: string;
          ttl?: number;
          parentBranchId?: string;
          initialTransfers?: TransferSpec;
        }>(c);
        const mountPath =
          typeof body.mountPath === "string" ? body.mountPath.trim().replace(/^\/+|\/+$/g, "") : "";
        if (!mountPath) {
          return c.json({ error: "BAD_REQUEST", message: "mountPath required" }, 400);
        }
        const ttlMs =
          typeof body.ttl === "number" && body.ttl > 0
            ? Math.min(body.ttl, maxTtlMs)
            : defaultTtlMs;
        const parentBranchId =
          typeof body.parentBranchId === "string"
            ? body.parentBranchId.trim() || undefined
            : undefined;
        if (body.initialTransfers !== undefined) {
          validateTransferSpec(body.initialTransfers);
        }

        const realmId = auth.type === "user" ? auth.userId : auth.realmId;

        if (!parentBranchId) {
          if (!hasBranchManage(auth)) {
            return c.json({ error: "FORBIDDEN", message: "branch_manage or user required" }, 403);
          }
          if (auth.type === "user" || auth.type === "delegate") {
            const emptyKey = await ensureEmptyRoot(deps.cas, deps.key);
            await deps.branchStore.ensureRealmRoot(realmId, emptyKey);
          }
          const rootRecord = await deps.branchStore.getRealmRootRecord(realmId);
          if (!rootRecord) {
            return c.json(
              {
                error: "NOT_FOUND",
                message: "Realm not initialized. Open your profile or realm first.",
              },
              404
            );
          }
          const rootKey = await deps.branchStore.getRealmRoot(realmId);
          if (rootKey === null) {
            return c.json(
              {
                error: "NOT_FOUND",
                message: "Realm not initialized. Open your profile or realm first.",
              },
              404
            );
          }
          const childRootKey = await resolvePath(deps.cas, rootKey, mountPath);
          if (childRootKey === null) {
            const branchId = crypto.randomUUID();
            const now = Date.now();
            const expiresAt = now + ttlMs;
            const verification = generateVerification(expiresAt);
            await deps.branchStore.insertBranch({
              branchId,
              realmId,
              parentId: rootRecord.branchId,
              expiresAt,
              accessVerification: { value: verification, expiresAt },
            });
            return c.json(
              buildCreateResponse(branchId, verification, expiresAt),
              201
            );
          }
          const branchId = crypto.randomUUID();
          const now = Date.now();
          const expiresAt = now + ttlMs;
          const verification = generateVerification(expiresAt);
          await deps.branchStore.insertBranch({
            branchId,
            realmId,
            parentId: rootRecord.branchId,
            expiresAt,
            accessVerification: { value: verification, expiresAt },
          });
          await deps.branchStore.setBranchRoot(branchId, childRootKey);
          return c.json(
            buildCreateResponse(branchId, verification, expiresAt),
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
          return c.json({ error: "BAD_REQUEST", message: "Parent branch has no root" }, 400);
        }
        const childRootKey = await resolvePath(deps.cas, parentRootKey, mountPath);
        if (childRootKey === null) {
          const childId = crypto.randomUUID();
          const now = Date.now();
          const expiresAt = now + ttlMs;
          const verification = generateVerification(expiresAt);
          await deps.branchStore.insertBranch({
            branchId: childId,
            realmId: parentBranch.realmId,
            parentId: parentBranchId,
            expiresAt,
            accessVerification: { value: verification, expiresAt },
          });
          return c.json(
            buildCreateResponse(childId, verification, expiresAt),
            201
          );
        }
        const childId = crypto.randomUUID();
        const now = Date.now();
        const expiresAt = now + ttlMs;
        const verification = generateVerification(expiresAt);
        await deps.branchStore.insertBranch({
          branchId: childId,
          realmId: parentBranch.realmId,
          parentId: parentBranchId,
          expiresAt,
          accessVerification: { value: verification, expiresAt },
        });
        await deps.branchStore.setBranchRoot(childId, childRootKey);
        return c.json(
          buildCreateResponse(childId, verification, expiresAt),
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
        return c.json(
          {
            branches: [
              {
                branchId: branch.branchId,
                parentId: branch.parentId,
                expiresAt: branch.expiresAt,
              },
            ],
          },
          200
        );
      }
      const realmId = auth.type === "user" ? auth.userId : auth.realmId;
      const branches = await deps.branchStore.listBranches(realmId);
      return c.json(
        {
          branches: branches.map((b: Branch) => ({
            branchId: b.branchId,
            parentId: b.parentId,
            expiresAt: b.expiresAt,
          })),
        },
        200
      );
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

    async close(c: Context<Env>) {
      const auth = c.get("auth");
      if (!auth) {
        return c.json({ error: "FORBIDDEN", message: "Auth required" }, 403);
      }
      const branchId = c.req.param("branchId");
      if (!branchId) {
        return c.json({ error: "BAD_REQUEST", message: "branchId required" }, 400);
      }
      if (auth.type === "worker") {
        if (auth.branchId !== branchId && branchId !== "me") {
          return c.json({ error: "FORBIDDEN", message: "Can only close own branch" }, 403);
        }
        const selfBranchId = branchId === "me" ? auth.branchId : branchId;
        const branch = await deps.branchStore.getBranch(selfBranchId);
        if (!branch) return c.json({ closed: selfBranchId }, 200);
        await deps.branchStore.removeBranch(selfBranchId);
        return c.json({ closed: selfBranchId }, 200);
      }
      if (!hasBranchManage(auth)) {
        return c.json({ error: "FORBIDDEN", message: "branch_manage or user required" }, 403);
      }
      const realmId = auth.type === "user" ? auth.userId : auth.realmId;
      const branch = await deps.branchStore.getBranch(branchId);
      if (!branch || branch.realmId !== realmId) {
        return c.json({ closed: branchId }, 200);
      }
      await deps.branchStore.removeBranch(branchId);
      return c.json({ closed: branchId }, 200);
    },

    async transferPaths(c: Context<Env>) {
      const auth = c.get("auth");
      if (!auth) {
        return c.json({ error: "FORBIDDEN", message: "Auth required" }, 403);
      }
      try {
        const body = await parseBody<TransferSpec>(c);
        const normalized = validateTransferSpec(body);
        const targetBranchId = c.req.param("branchId");
        if (!targetBranchId) {
          return c.json({ error: "BAD_REQUEST", message: "branchId required" }, 400);
        }
        if (normalized.target !== targetBranchId) {
          return c.json({ error: "BAD_REQUEST", message: "target must equal path branchId" }, 400);
        }
        if (auth.type === "worker") {
          if (auth.branchId !== targetBranchId || normalized.source !== auth.branchId) {
            return c.json(
              { error: "FORBIDDEN", message: "Worker can only transfer within own branch" },
              403
            );
          }
        } else if (!hasBranchManage(auth)) {
          return c.json({ error: "FORBIDDEN", message: "branch_manage or user required" }, 403);
        }
        const result = await executeTransfer(normalized, deps);
        return c.json(result, 200);
      } catch (err) {
        const message = err instanceof Error ? err.message : "transfer_paths failed";
        if (
          message.includes("required") ||
          message.includes("must not") ||
          message.includes("exists") ||
          message.includes("not found") ||
          message.includes("same realm") ||
          message.includes("not implemented")
        ) {
          return c.json({ error: "BAD_REQUEST", message }, 400);
        }
        throw err;
      }
    },
  };
}
