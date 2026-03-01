/**
 * File list and stat (metadata) handlers.
 * Path from route param: /api/realm/:realmId/files/*path → path = "" or "foo/bar".
 */
import type { Context } from "hono";
import type { Env } from "../types.ts";
import type { RootResolverDeps } from "../services/root-resolver.ts";
import {
  getCurrentRoot,
  resolvePath,
  getNodeDecoded,
  getEffectiveDelegateId,
} from "../services/root-resolver.ts";
import { addOrReplaceAtPath } from "../services/tree-mutations.ts";
import { encodeFileNode, hashToKey } from "@casfa/core";
import { streamFromBytes } from "@casfa/cas";

function hasFileRead(auth: NonNullable<Env["Variables"]["auth"]>): boolean {
  if (auth.type === "user") return true;
  if (auth.type === "delegate") return auth.permissions.includes("file_read");
  return auth.access === "readwrite" || auth.access === "readonly";
}

function hasFileWrite(auth: NonNullable<Env["Variables"]["auth"]>): boolean {
  if (auth.type === "user") return true;
  if (auth.type === "delegate") return auth.permissions.includes("file_write");
  return auth.access === "readwrite";
}

export type FilesControllerDeps = RootResolverDeps;

function getPathParam(c: Context<Env>): string {
  const path = c.req.param("path");
  if (path == null) return "";
  return path;
}

export function createFilesController(deps: FilesControllerDeps) {
  return {
    async list(c: Context<Env>) {
      const auth = c.get("auth");
      if (!auth || !hasFileRead(auth)) {
        return c.json({ error: "FORBIDDEN", message: "file_read required" }, 403);
      }
      const pathStr = getPathParam(c);
      try {
        const rootKey = await getCurrentRoot(auth, deps);
        if (rootKey === null) {
          return c.json({ error: "NOT_FOUND", message: "Realm or branch root not found" }, 404);
        }
        const nodeKey = await resolvePath(deps.cas, rootKey, pathStr);
        if (nodeKey === null) {
          return c.json({ error: "NOT_FOUND", message: "Path not found" }, 404);
        }
        const node = await getNodeDecoded(deps.cas, nodeKey);
        if (!node) {
          return c.json({ error: "NOT_FOUND", message: "Node not found" }, 404);
        }
        if (node.kind !== "dict") {
          return c.json({ error: "BAD_REQUEST", message: "Not a directory" }, 400);
        }
        const names = node.childNames ?? [];
        const children = node.children ?? [];
        const entries: { name: string; kind: "file" | "directory"; size?: number }[] = [];
        for (let i = 0; i < names.length; i++) {
          const name = names[i]!;
          const childKey = hashToKey(children[i]!);
          const childNode = await getNodeDecoded(deps.cas, childKey);
          const kind = childNode?.kind === "file" ? "file" : "directory";
          const size = childNode?.kind === "file" ? childNode.fileInfo?.fileSize : undefined;
          entries.push({ name, kind, ...(size !== undefined && { size }) });
        }
        return c.json({ entries }, 200);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Invalid path";
        if (message.includes("must not contain")) {
          return c.json({ error: "BAD_REQUEST", message }, 400);
        }
        throw err;
      }
    },

    async stat(c: Context<Env>) {
      const auth = c.get("auth");
      if (!auth || !hasFileRead(auth)) {
        return c.json({ error: "FORBIDDEN", message: "file_read required" }, 403);
      }
      const pathStr = getPathParam(c);
      try {
        const rootKey = await getCurrentRoot(auth, deps);
        if (rootKey === null) {
          return c.json({ error: "NOT_FOUND", message: "Realm or branch root not found" }, 404);
        }
        const nodeKey = await resolvePath(deps.cas, rootKey, pathStr);
        if (nodeKey === null) {
          return c.json({ error: "NOT_FOUND", message: "Path not found" }, 404);
        }
        const node = await getNodeDecoded(deps.cas, nodeKey);
        if (!node) {
          return c.json({ error: "NOT_FOUND", message: "Node not found" }, 404);
        }
        if (node.kind === "file") {
          return c.json(
            {
              kind: "file",
              size: node.fileInfo?.fileSize ?? 0,
              contentType: node.fileInfo?.contentType ?? "application/octet-stream",
            },
            200
          );
        }
        return c.json({ kind: "directory" }, 200);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Invalid path";
        if (message.includes("must not contain")) {
          return c.json({ error: "BAD_REQUEST", message }, 400);
        }
        throw err;
      }
    },

    /** GET without meta: file → download, directory → list. */
    async getOrList(c: Context<Env>) {
      const auth = c.get("auth");
      if (!auth || !hasFileRead(auth)) {
        return c.json({ error: "FORBIDDEN", message: "file_read required" }, 403);
      }
      const pathStr = getPathParam(c);
      try {
        const rootKey = await getCurrentRoot(auth, deps);
        if (rootKey === null) {
          return c.json({ error: "NOT_FOUND", message: "Realm or branch root not found" }, 404);
        }
        const nodeKey = await resolvePath(deps.cas, rootKey, pathStr);
        if (nodeKey === null) {
          return c.json({ error: "NOT_FOUND", message: "Path not found" }, 404);
        }
        const node = await getNodeDecoded(deps.cas, nodeKey);
        if (!node) {
          return c.json({ error: "NOT_FOUND", message: "Node not found" }, 404);
        }
        if (node.kind === "file") {
          const data = node.data ?? new Uint8Array(0);
          const contentType = node.fileInfo?.contentType ?? "application/octet-stream";
          return new Response(data, {
            status: 200,
            headers: {
              "Content-Type": contentType,
              "Content-Length": String(data.length),
            },
          });
        }
        const names = node.childNames ?? [];
        const children = node.children ?? [];
        const entries: { name: string; kind: "file" | "directory"; size?: number }[] = [];
        for (let i = 0; i < names.length; i++) {
          const name = names[i]!;
          const childKey = hashToKey(children[i]!);
          const childNode = await getNodeDecoded(deps.cas, childKey);
          const kind = childNode?.kind === "file" ? "file" : "directory";
          const size = childNode?.kind === "file" ? childNode.fileInfo?.fileSize : undefined;
          entries.push({ name, kind, ...(size !== undefined && { size }) });
        }
        return c.json({ entries }, 200);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Invalid path";
        if (message.includes("must not contain")) {
          return c.json({ error: "BAD_REQUEST", message }, 400);
        }
        throw err;
      }
    },

    /** PUT file: body = full file (single-node, max 4MB). Path = parent path + file name. */
    async upload(c: Context<Env>) {
      const auth = c.get("auth");
      if (!auth || !hasFileWrite(auth)) {
        return c.json({ error: "FORBIDDEN", message: "file_write required" }, 403);
      }
      const pathStr = getPathParam(c);
      const MAX_BODY = 4 * 1024 * 1024;
      try {
        const raw = await c.req.raw.arrayBuffer();
        if (raw.byteLength > MAX_BODY) {
          return c.json(
            { error: "BAD_REQUEST", message: `Body too large (max ${MAX_BODY} bytes)` },
            400
          );
        }
        const pathSegments = pathStr.split("/").filter((s) => s.length > 0);
        if (pathSegments.length === 0) {
          return c.json({ error: "BAD_REQUEST", message: "Path must include file name" }, 400);
        }
        const rootKey = await getCurrentRoot(auth, deps);
        if (rootKey === null) {
          return c.json({ error: "NOT_FOUND", message: "Realm or branch root not found" }, 404);
        }
        const data = new Uint8Array(raw);
        const contentType =
          c.req.header("Content-Type")?.split(";")[0]?.trim() ||
          "application/octet-stream";
        const encoded = await encodeFileNode(
          { data, fileSize: data.length, contentType },
          deps.key
        );
        const fileNodeKey = hashToKey(encoded.hash);
        await deps.cas.putNode(fileNodeKey, streamFromBytes(encoded.bytes));
        const newRootKey = await addOrReplaceAtPath(
          deps.cas,
          deps.key,
          rootKey,
          pathStr,
          fileNodeKey
        );
        const delegateId = await getEffectiveDelegateId(auth, deps);
        await deps.delegateStore.setRoot(delegateId, newRootKey);
        return c.json({ path: pathStr, key: fileNodeKey }, 201);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Upload failed";
        if (
          message.includes("must not contain") ||
          message.includes("Path must not be empty") ||
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
