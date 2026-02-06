/**
 * Filesystem Controller
 *
 * HTTP handlers for filesystem operations on CAS trees.
 * Mounts under /api/realm/{realmId}/nodes/{nodeKey}/fs/...
 *
 * Based on docs/casfa-api/05-filesystem.md
 */

import type { Context } from "hono";
import type {
  FsMkdirRequest,
  FsMvRequest,
  FsCpRequest,
  FsRewriteEntry,
  FsRmRequest,
} from "@casfa/protocol";
import type { AccessTokenAuthContext, Env } from "../types.ts";
import type { FsService, FsError } from "../services/fs/index.ts";

// ============================================================================
// Types
// ============================================================================

export type FilesystemController = {
  stat: (c: Context<Env>) => Promise<Response>;
  read: (c: Context<Env>) => Promise<Response>;
  ls: (c: Context<Env>) => Promise<Response>;
  write: (c: Context<Env>) => Promise<Response>;
  mkdir: (c: Context<Env>) => Promise<Response>;
  rm: (c: Context<Env>) => Promise<Response>;
  mv: (c: Context<Env>) => Promise<Response>;
  cp: (c: Context<Env>) => Promise<Response>;
  rewrite: (c: Context<Env>) => Promise<Response>;
};

export type FilesystemControllerDeps = {
  fsService: FsService;
};

// ============================================================================
// Helpers
// ============================================================================

const isFsError = (result: unknown): result is FsError => {
  return typeof result === "object" && result !== null && "code" in result && "status" in result;
};

const fsErrorResponse = (c: Context<Env>, err: FsError) => {
  return c.json(
    {
      error: err.code,
      message: err.message,
      ...(err.details ? { details: err.details } : {}),
    },
    err.status as 400
  );
};

const getRealm = (c: Context<Env>): string => {
  return c.req.param("realmId") ?? c.get("auth").realm;
};

const getNodeKey = (c: Context<Env>): string => {
  return decodeURIComponent(c.req.param("key"));
};

const getTokenId = (c: Context<Env>): string => {
  const auth = c.get("auth") as AccessTokenAuthContext;
  return auth.tokenId;
};

// ============================================================================
// Factory
// ============================================================================

export const createFilesystemController = (
  deps: FilesystemControllerDeps
): FilesystemController => {
  const { fsService } = deps;

  return {
    /**
     * GET /fs/stat - Get file/directory metadata
     */
    stat: async (c) => {
      const realm = getRealm(c);
      const nodeKey = getNodeKey(c);
      const path = c.req.query("path");
      const indexPath = c.req.query("indexPath");

      const result = await fsService.stat(realm, nodeKey, path, indexPath);
      if (isFsError(result)) return fsErrorResponse(c, result);

      return c.json(result);
    },

    /**
     * GET /fs/read - Read file content
     */
    read: async (c) => {
      const realm = getRealm(c);
      const nodeKey = getNodeKey(c);
      const path = c.req.query("path");
      const indexPath = c.req.query("indexPath");

      const result = await fsService.read(realm, nodeKey, path, indexPath);
      if (isFsError(result)) return fsErrorResponse(c, result);

      return new Response(result.data, {
        status: 200,
        headers: {
          "Content-Type": result.contentType,
          "Content-Length": String(result.size),
          "X-CAS-Key": result.key,
        },
      });
    },

    /**
     * GET /fs/ls - List directory contents
     */
    ls: async (c) => {
      const realm = getRealm(c);
      const nodeKey = getNodeKey(c);
      const path = c.req.query("path");
      const indexPath = c.req.query("indexPath");
      const limit = c.req.query("limit") ? Number.parseInt(c.req.query("limit")!, 10) : 100;
      const cursor = c.req.query("cursor");

      const result = await fsService.ls(realm, nodeKey, path, indexPath, limit, cursor);
      if (isFsError(result)) return fsErrorResponse(c, result);

      return c.json(result);
    },

    /**
     * POST /fs/write - Create or overwrite file
     */
    write: async (c) => {
      const realm = getRealm(c);
      const nodeKey = getNodeKey(c);
      const tokenId = getTokenId(c);
      const path = c.req.query("path");
      const indexPath = c.req.query("indexPath");
      const contentType = c.req.header("Content-Type") ?? "application/octet-stream";
      const contentLength = c.req.header("Content-Length");

      // Read binary body
      const arrayBuffer = await c.req.arrayBuffer();
      const fileContent = new Uint8Array(arrayBuffer);

      // Validate content-length if provided
      if (contentLength) {
        const declaredLength = Number.parseInt(contentLength, 10);
        if (!Number.isNaN(declaredLength) && declaredLength !== fileContent.length) {
          return c.json(
            {
              error: "CONTENT_LENGTH_MISMATCH",
              message: `Declared Content-Length (${declaredLength}) does not match actual body size (${fileContent.length})`,
            },
            400
          );
        }
      }

      const result = await fsService.write(
        realm, tokenId, nodeKey, path, indexPath, fileContent, contentType
      );
      if (isFsError(result)) return fsErrorResponse(c, result);

      return c.json(result);
    },

    /**
     * POST /fs/mkdir - Create directory
     */
    mkdir: async (c) => {
      const realm = getRealm(c);
      const nodeKey = getNodeKey(c);
      const tokenId = getTokenId(c);

      let body: FsMkdirRequest;
      try {
        body = await c.req.json();
      } catch {
        return c.json({ error: "INVALID_REQUEST", message: "Invalid JSON body" }, 400);
      }

      if (!body.path || typeof body.path !== "string") {
        return c.json({ error: "INVALID_PATH", message: "path is required" }, 400);
      }

      const result = await fsService.mkdir(realm, tokenId, nodeKey, body.path);
      if (isFsError(result)) return fsErrorResponse(c, result);

      return c.json(result);
    },

    /**
     * POST /fs/rm - Remove file or directory
     */
    rm: async (c) => {
      const realm = getRealm(c);
      const nodeKey = getNodeKey(c);
      const tokenId = getTokenId(c);

      let body: FsRmRequest;
      try {
        body = await c.req.json();
      } catch {
        return c.json({ error: "INVALID_REQUEST", message: "Invalid JSON body" }, 400);
      }

      if (!body.path && !body.indexPath) {
        return c.json({ error: "INVALID_PATH", message: "path or indexPath is required" }, 400);
      }

      const result = await fsService.rm(realm, tokenId, nodeKey, body.path, body.indexPath);
      if (isFsError(result)) return fsErrorResponse(c, result);

      return c.json(result);
    },

    /**
     * POST /fs/mv - Move/rename file or directory
     */
    mv: async (c) => {
      const realm = getRealm(c);
      const nodeKey = getNodeKey(c);
      const tokenId = getTokenId(c);

      let body: FsMvRequest;
      try {
        body = await c.req.json();
      } catch {
        return c.json({ error: "INVALID_REQUEST", message: "Invalid JSON body" }, 400);
      }

      if (!body.from || !body.to) {
        return c.json({ error: "INVALID_PATH", message: "from and to are required" }, 400);
      }

      const result = await fsService.mv(realm, tokenId, nodeKey, body.from, body.to);
      if (isFsError(result)) return fsErrorResponse(c, result);

      return c.json(result);
    },

    /**
     * POST /fs/cp - Copy file or directory
     */
    cp: async (c) => {
      const realm = getRealm(c);
      const nodeKey = getNodeKey(c);
      const tokenId = getTokenId(c);

      let body: FsCpRequest;
      try {
        body = await c.req.json();
      } catch {
        return c.json({ error: "INVALID_REQUEST", message: "Invalid JSON body" }, 400);
      }

      if (!body.from || !body.to) {
        return c.json({ error: "INVALID_PATH", message: "from and to are required" }, 400);
      }

      const result = await fsService.cp(realm, tokenId, nodeKey, body.from, body.to);
      if (isFsError(result)) return fsErrorResponse(c, result);

      return c.json(result);
    },

    /**
     * POST /fs/rewrite - Declarative batch rewrite
     */
    rewrite: async (c) => {
      const realm = getRealm(c);
      const nodeKey = getNodeKey(c);
      const tokenId = getTokenId(c);

      let body: { entries?: Record<string, FsRewriteEntry>; deletes?: string[] };
      try {
        body = await c.req.json();
      } catch {
        return c.json({ error: "INVALID_REQUEST", message: "Invalid JSON body" }, 400);
      }

      const result = await fsService.rewrite(
        realm, tokenId, nodeKey, body.entries, body.deletes
      );
      if (isFsError(result)) return fsErrorResponse(c, result);

      return c.json(result);
    },
  };
};
