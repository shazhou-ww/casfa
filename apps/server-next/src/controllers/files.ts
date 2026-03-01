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
} from "../services/root-resolver.ts";
import { hashToKey } from "@casfa/core";

function hasFileRead(auth: NonNullable<Env["Variables"]["auth"]>): boolean {
  if (auth.type === "user") return true;
  if (auth.type === "delegate") return auth.permissions.includes("file_read");
  return auth.access === "readwrite" || auth.access === "readonly";
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

    /** GET file body (single-node file). Returns 404 if path is dir or missing. */
    async download(c: Context<Env>) {
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
        if (!node || node.kind !== "file") {
          return c.json({ error: "NOT_FOUND", message: "Not a file" }, 404);
        }
        const data = node.data ?? new Uint8Array(0);
        const contentType = node.fileInfo?.contentType ?? "application/octet-stream";
        return new Response(data, {
          status: 200,
          headers: {
            "Content-Type": contentType,
            "Content-Length": String(data.length),
          },
        });
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
  };
}
