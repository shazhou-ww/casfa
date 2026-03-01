/**
 * FS operations: mkdir, rm, mv, cp.
 * Body and routes per API design §4.4: POST .../fs/mkdir (body: path), etc.
 */
import type { Context } from "hono";
import type { Env } from "../types.ts";
import type { RootResolverDeps } from "../services/root-resolver.ts";
import {
  getCurrentRoot,
  resolvePath,
  getEffectiveDelegateId,
} from "../services/root-resolver.ts";
import {
  addOrReplaceAtPath,
  removeEntryAtPath,
} from "../services/tree-mutations.ts";
import { encodeDictNode, hashToKey } from "@casfa/core";
import { streamFromBytes } from "@casfa/cas";

function hasFileWrite(auth: NonNullable<Env["Variables"]["auth"]>): boolean {
  if (auth.type === "user") return true;
  if (auth.type === "delegate") return auth.permissions.includes("file_write");
  return auth.access === "readwrite";
}

export type FsControllerDeps = RootResolverDeps;

async function parseBodyJson<T>(c: Context<Env>): Promise<T> {
  return c.req.json<T>().catch(() => ({} as T));
}

export function createFsController(deps: FsControllerDeps) {
  return {
    async mkdir(c: Context<Env>) {
      const auth = c.get("auth");
      if (!auth || !hasFileWrite(auth)) {
        return c.json({ error: "FORBIDDEN", message: "file_write required" }, 403);
      }
      try {
        const body = await parseBodyJson<{ path: string }>(c);
        const pathStr = typeof body.path === "string" ? body.path.trim().replace(/^\/+|\/+$/g, "") : "";
        if (!pathStr) {
          return c.json({ error: "BAD_REQUEST", message: "path required" }, 400);
        }
        const rootKey = await getCurrentRoot(auth, deps);
        if (rootKey === null) {
          return c.json({ error: "NOT_FOUND", message: "Realm or branch root not found" }, 404);
        }
        const emptyDict = await encodeDictNode({ children: [], childNames: [] }, deps.key);
        const emptyDictKey = hashToKey(emptyDict.hash);
        await deps.cas.putNode(emptyDictKey, streamFromBytes(emptyDict.bytes));
        const newRootKey = await addOrReplaceAtPath(
          deps.cas,
          deps.key,
          rootKey,
          pathStr,
          emptyDictKey
        );
        const delegateId = await getEffectiveDelegateId(auth, deps);
        await deps.delegateStore.setRoot(delegateId, newRootKey);
        return c.json({ path: pathStr }, 201);
      } catch (err) {
        const message = err instanceof Error ? err.message : "mkdir failed";
        if (
          message.includes("must not contain") ||
          message.includes("Parent path not found") ||
          message.includes("Not a dict")
        ) {
          return c.json({ error: "BAD_REQUEST", message }, 400);
        }
        throw err;
      }
    },

    async rm(c: Context<Env>) {
      const auth = c.get("auth");
      if (!auth || !hasFileWrite(auth)) {
        return c.json({ error: "FORBIDDEN", message: "file_write required" }, 403);
      }
      try {
        const body = await parseBodyJson<{ path?: string; paths?: string[] }>(c);
        const paths: string[] = body.paths ?? (body.path != null ? [body.path] : []);
        if (paths.length === 0) {
          return c.json({ error: "BAD_REQUEST", message: "path or paths required" }, 400);
        }
        let rootKey = await getCurrentRoot(auth, deps);
        if (rootKey === null) {
          return c.json({ error: "NOT_FOUND", message: "Realm or branch root not found" }, 404);
        }
        for (const p of paths) {
          const pathStr = p.trim().replace(/^\/+|\/+$/g, "");
          if (!pathStr) continue;
          rootKey = await removeEntryAtPath(deps.cas, deps.key, rootKey, pathStr);
        }
        const delegateId = await getEffectiveDelegateId(auth, deps);
        await deps.delegateStore.setRoot(delegateId, rootKey);
        return c.json({ removed: paths.length }, 200);
      } catch (err) {
        const message = err instanceof Error ? err.message : "rm failed";
        if (
          message.includes("must not contain") ||
          message.includes("not found") ||
          message.includes("Parent path")
        ) {
          return c.json({ error: "BAD_REQUEST", message }, 400);
        }
        throw err;
      }
    },

    async mv(c: Context<Env>) {
      const auth = c.get("auth");
      if (!auth || !hasFileWrite(auth)) {
        return c.json({ error: "FORBIDDEN", message: "file_write required" }, 403);
      }
      try {
        const body = await parseBodyJson<{ from: string; to: string }>(c);
        const fromStr = typeof body.from === "string" ? body.from.trim().replace(/^\/+|\/+$/g, "") : "";
        const toStr = typeof body.to === "string" ? body.to.trim().replace(/^\/+|\/+$/g, "") : "";
        if (!fromStr || !toStr) {
          return c.json({ error: "BAD_REQUEST", message: "from and to required" }, 400);
        }
        let rootKey = await getCurrentRoot(auth, deps);
        if (rootKey === null) {
          return c.json({ error: "NOT_FOUND", message: "Realm or branch root not found" }, 404);
        }
        const nodeKey = await resolvePath(deps.cas, rootKey, fromStr);
        if (nodeKey === null) {
          return c.json({ error: "NOT_FOUND", message: "from path not found" }, 404);
        }
        rootKey = await removeEntryAtPath(deps.cas, deps.key, rootKey, fromStr);
        rootKey = await addOrReplaceAtPath(deps.cas, deps.key, rootKey, toStr, nodeKey);
        const delegateId = await getEffectiveDelegateId(auth, deps);
        await deps.delegateStore.setRoot(delegateId, rootKey);
        return c.json({ from: fromStr, to: toStr }, 200);
      } catch (err) {
        const message = err instanceof Error ? err.message : "mv failed";
        if (
          message.includes("must not contain") ||
          message.includes("not found") ||
          message.includes("Parent path")
        ) {
          return c.json({ error: "BAD_REQUEST", message }, 400);
        }
        throw err;
      }
    },

    async cp(c: Context<Env>) {
      const auth = c.get("auth");
      if (!auth || !hasFileWrite(auth)) {
        return c.json({ error: "FORBIDDEN", message: "file_write required" }, 403);
      }
      try {
        const body = await parseBodyJson<{ from: string; to: string }>(c);
        const fromStr = typeof body.from === "string" ? body.from.trim().replace(/^\/+|\/+$/g, "") : "";
        const toStr = typeof body.to === "string" ? body.to.trim().replace(/^\/+|\/+$/g, "") : "";
        if (!fromStr || !toStr) {
          return c.json({ error: "BAD_REQUEST", message: "from and to required" }, 400);
        }
        const rootKey = await getCurrentRoot(auth, deps);
        if (rootKey === null) {
          return c.json({ error: "NOT_FOUND", message: "Realm or branch root not found" }, 404);
        }
        const nodeKey = await resolvePath(deps.cas, rootKey, fromStr);
        if (nodeKey === null) {
          return c.json({ error: "NOT_FOUND", message: "from path not found" }, 404);
        }
        const newRootKey = await addOrReplaceAtPath(deps.cas, deps.key, rootKey, toStr, nodeKey);
        const delegateId = await getEffectiveDelegateId(auth, deps);
        await deps.delegateStore.setRoot(delegateId, newRootKey);
        return c.json({ from: fromStr, to: toStr }, 201);
      } catch (err) {
        const message = err instanceof Error ? err.message : "cp failed";
        if (
          message.includes("must not contain") ||
          message.includes("Parent path not found") ||
          message.includes("Not a dict")
        ) {
          return c.json({ error: "BAD_REQUEST", message }, 400);
        }
        throw err;
      }
    },
  };
}
