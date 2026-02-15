/**
 * Filesystem Controller
 *
 * HTTP handlers for filesystem operations on CAS trees.
 * Mounts under /api/realm/{realmId}/nodes/{nodeKey}/fs/...
 *
 * Based on docs/casfa-api/04-realm/03-filesystem.md
 */

import { type PathSegment, parsePathSegments } from "@casfa/cas-uri";
import type {
  FsCpRequest,
  FsMkdirRequest,
  FsMvRequest,
  FsRewriteRequest,
  FsRmRequest,
} from "@casfa/protocol";
import type { Context } from "hono";
import type { FsError, FsService } from "../services/fs/index.ts";
import type { AccessTokenAuthContext, Env } from "../types.ts";

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

const getAuth = (c: Context<Env>): AccessTokenAuthContext => {
  return c.get("auth") as AccessTokenAuthContext;
};

/** Get the ownerId for write operations (delegate ID) */
const getOwnerId = (c: Context<Env>): string => {
  const auth = getAuth(c);
  return auth.delegateId;
};

/**
 * Parse the `path` query parameter into PathSegment[].
 * Returns an error Response if the path contains invalid ~N segments.
 */
const parsePathParam = (
  c: Context<Env>
): { ok: true; segments: PathSegment[] } | { ok: false; response: Response } => {
  const pathStr = c.req.query("path");
  const result = parsePathSegments(pathStr);
  if (!result.ok) {
    return {
      ok: false as const,
      response: c.json({ error: "INVALID_PATH", message: result.error.message }, 400),
    };
  }
  return { ok: true as const, segments: result.segments };
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
      const parsed = parsePathParam(c);
      if (!parsed.ok) return parsed.response;

      const result = await fsService.stat(realm, nodeKey, parsed.segments);
      if (isFsError(result)) return fsErrorResponse(c, result);

      return c.json(result);
    },

    /**
     * GET /fs/read - Read file content
     */
    read: async (c) => {
      const realm = getRealm(c);
      const nodeKey = getNodeKey(c);
      const parsed = parsePathParam(c);
      if (!parsed.ok) return parsed.response;

      const result = await fsService.read(realm, nodeKey, parsed.segments);
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
      const parsed = parsePathParam(c);
      if (!parsed.ok) return parsed.response;
      const limit = c.req.query("limit") ? Number.parseInt(c.req.query("limit")!, 10) : 100;
      const cursor = c.req.query("cursor");

      const result = await fsService.ls(realm, nodeKey, parsed.segments, limit, cursor);
      if (isFsError(result)) return fsErrorResponse(c, result);

      return c.json(result);
    },

    /**
     * POST /fs/write - Create or overwrite file
     */
    write: async (c) => {
      const realm = getRealm(c);
      const nodeKey = getNodeKey(c);
      const ownerId = getOwnerId(c);
      const parsed = parsePathParam(c);
      if (!parsed.ok) return parsed.response;
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
        realm,
        ownerId,
        nodeKey,
        parsed.segments,
        fileContent,
        contentType
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
      const ownerId = getOwnerId(c);
      const body = c.req.valid("json" as never) as FsMkdirRequest;

      const result = await fsService.mkdir(realm, ownerId, nodeKey, body.path);
      if (isFsError(result)) return fsErrorResponse(c, result);

      return c.json(result);
    },

    /**
     * POST /fs/rm - Remove file or directory
     */
    rm: async (c) => {
      const realm = getRealm(c);
      const nodeKey = getNodeKey(c);
      const ownerId = getOwnerId(c);
      const body = c.req.valid("json" as never) as FsRmRequest;

      const rmParsed = parsePathSegments(body.path);
      if (!rmParsed.ok) {
        return c.json({ error: "INVALID_PATH", message: rmParsed.error.message }, 400);
      }

      const result = await fsService.rm(realm, ownerId, nodeKey, rmParsed.segments);
      if (isFsError(result)) return fsErrorResponse(c, result);

      return c.json(result);
    },

    /**
     * POST /fs/mv - Move/rename file or directory
     */
    mv: async (c) => {
      const realm = getRealm(c);
      const nodeKey = getNodeKey(c);
      const ownerId = getOwnerId(c);
      const body = c.req.valid("json" as never) as FsMvRequest;

      const result = await fsService.mv(realm, ownerId, nodeKey, body.from, body.to);
      if (isFsError(result)) return fsErrorResponse(c, result);

      return c.json(result);
    },

    /**
     * POST /fs/cp - Copy file or directory
     */
    cp: async (c) => {
      const realm = getRealm(c);
      const nodeKey = getNodeKey(c);
      const ownerId = getOwnerId(c);
      const body = c.req.valid("json" as never) as FsCpRequest;

      const result = await fsService.cp(realm, ownerId, nodeKey, body.from, body.to);
      if (isFsError(result)) return fsErrorResponse(c, result);

      return c.json(result);
    },

    /**
     * POST /fs/rewrite - Declarative batch rewrite
     */
    rewrite: async (c) => {
      const realm = getRealm(c);
      const nodeKey = getNodeKey(c);
      const ownerId = getOwnerId(c);
      const auth = getAuth(c);
      const body = c.req.valid("json" as never) as FsRewriteRequest;

      const result = await fsService.rewrite(
        realm,
        ownerId,
        nodeKey,
        body.entries,
        body.deletes,
        auth.issuerChain,
        auth.delegateId,
        auth
      );
      if (isFsError(result)) return fsErrorResponse(c, result);

      return c.json(result);
    },
  };
};
