/**
 * Filesystem operation schemas
 *
 * Schemas and types for the CAS filesystem API.
 * All fs operations are mounted under /api/realm/{realmId}/nodes/{nodeKey}/fs/...
 *
 * Based on docs/casfa-api/05-filesystem.md
 */

import { z } from "zod";
import { NODE_KEY_REGEX } from "./common.ts";

// ============================================================================
// Constants
// ============================================================================

/** Maximum single-block file size (4 MB) */
export const FS_MAX_NODE_SIZE = 4 * 1024 * 1024;

/** Maximum file/dir name length in UTF-8 bytes */
export const FS_MAX_NAME_BYTES = 255;

/** Maximum children per d-node */
export const FS_MAX_COLLECTION_CHILDREN = 10000;

/** Maximum entries + deletes in a single rewrite request */
export const FS_MAX_REWRITE_ENTRIES = 100;

// ============================================================================
// Common: File/Dir type discriminator
// ============================================================================

/** Node type as exposed by the fs API ("file" | "dir") */
export const FsNodeTypeSchema = z.enum(["file", "dir"]);
export type FsNodeType = z.infer<typeof FsNodeTypeSchema>;

// ============================================================================
// Query parameters
// ============================================================================

/**
 * Common query parameters for path-based fs operations.
 * Corresponds to CAS URI path + index-path.
 */
export const FsPathQuerySchema = z.object({
  /** Name-based relative path, e.g. "src/main.ts" */
  path: z.string().optional(),
  /** Index-based path, e.g. "1:0" */
  indexPath: z.string().optional(),
});

export type FsPathQuery = z.infer<typeof FsPathQuerySchema>;

/**
 * Query parameters for ls (adds pagination).
 */
export const FsLsQuerySchema = FsPathQuerySchema.extend({
  /** Items per page, default 100, max 1000 */
  limit: z.coerce.number().int().min(1).max(1000).optional().default(100),
  /** Pagination cursor (opaque string from previous response) */
  cursor: z.string().optional(),
});

export type FsLsQuery = z.infer<typeof FsLsQuerySchema>;

// ============================================================================
// stat
// ============================================================================

/**
 * Response for GET .../fs/stat
 */
export const FsStatResponseSchema = z.object({
  type: FsNodeTypeSchema,
  name: z.string(),
  key: z.string(),
  /** File size in bytes (file only) */
  size: z.number().int().nonnegative().optional(),
  /** MIME type (file only) */
  contentType: z.string().optional(),
  /** Number of direct children (dir only) */
  childCount: z.number().int().nonnegative().optional(),
});

export type FsStatResponse = z.infer<typeof FsStatResponseSchema>;

// ============================================================================
// ls
// ============================================================================

/** Single child entry in an ls response */
export const FsLsChildSchema = z.object({
  name: z.string(),
  /** Global index in the d-node children array (stable across pages) */
  index: z.number().int().nonnegative(),
  type: FsNodeTypeSchema,
  key: z.string(),
  /** File size in bytes (file only) */
  size: z.number().int().nonnegative().optional(),
  /** MIME type (file only) */
  contentType: z.string().optional(),
  /** Number of direct children (dir only) */
  childCount: z.number().int().nonnegative().optional(),
});

export type FsLsChild = z.infer<typeof FsLsChildSchema>;

/** Response for GET .../fs/ls */
export const FsLsResponseSchema = z.object({
  /** Current directory path (empty string for root) */
  path: z.string(),
  /** CAS key of the directory */
  key: z.string(),
  children: z.array(FsLsChildSchema),
  /** Total number of children in this directory */
  total: z.number().int().nonnegative(),
  /** Next-page cursor, null when no more data */
  nextCursor: z.string().nullable(),
});

export type FsLsResponse = z.infer<typeof FsLsResponseSchema>;

// ============================================================================
// write
// ============================================================================

/**
 * Response for POST .../fs/write
 *
 * Request body is raw binary (the file content).
 * Path & content-type are passed via query params / headers.
 */
export const FsWriteResponseSchema = z.object({
  newRoot: z.string(),
  file: z.object({
    path: z.string(),
    key: z.string(),
    size: z.number().int().nonnegative(),
    contentType: z.string(),
  }),
  /** true = new file created; false = existing file overwritten */
  created: z.boolean(),
});

export type FsWriteResponse = z.infer<typeof FsWriteResponseSchema>;

// ============================================================================
// mkdir
// ============================================================================

/** Request body for POST .../fs/mkdir */
export const FsMkdirRequestSchema = z.object({
  /** Directory path (name-based only) */
  path: z.string().min(1),
});

export type FsMkdirRequest = z.infer<typeof FsMkdirRequestSchema>;

/** Response for POST .../fs/mkdir */
export const FsMkdirResponseSchema = z.object({
  newRoot: z.string(),
  dir: z.object({
    path: z.string(),
    key: z.string(),
  }),
  /** true = new directory created; false = directory already existed (idempotent) */
  created: z.boolean(),
});

export type FsMkdirResponse = z.infer<typeof FsMkdirResponseSchema>;

// ============================================================================
// rm
// ============================================================================

/** Request body for POST .../fs/rm */
export const FsRmRequestSchema = z
  .object({
    /** Name-based path */
    path: z.string().optional(),
    /** Index-based path */
    indexPath: z.string().optional(),
  })
  .refine((d) => d.path || d.indexPath, {
    message: "Either path or indexPath must be provided",
  });

export type FsRmRequest = z.infer<typeof FsRmRequestSchema>;

/** Response for POST .../fs/rm */
export const FsRmResponseSchema = z.object({
  newRoot: z.string(),
  removed: z.object({
    path: z.string(),
    type: FsNodeTypeSchema,
    key: z.string(),
  }),
});

export type FsRmResponse = z.infer<typeof FsRmResponseSchema>;

// ============================================================================
// mv
// ============================================================================

/** Request body for POST .../fs/mv */
export const FsMvRequestSchema = z.object({
  /** Source path (name-based) */
  from: z.string().min(1),
  /** Destination path (name-based) */
  to: z.string().min(1),
});

export type FsMvRequest = z.infer<typeof FsMvRequestSchema>;

/** Response for POST .../fs/mv */
export const FsMvResponseSchema = z.object({
  newRoot: z.string(),
  from: z.string(),
  to: z.string(),
});

export type FsMvResponse = z.infer<typeof FsMvResponseSchema>;

// ============================================================================
// cp
// ============================================================================

/** Request body for POST .../fs/cp */
export const FsCpRequestSchema = z.object({
  /** Source path (name-based) */
  from: z.string().min(1),
  /** Destination path (name-based) */
  to: z.string().min(1),
});

export type FsCpRequest = z.infer<typeof FsCpRequestSchema>;

/** Response for POST .../fs/cp */
export const FsCpResponseSchema = z.object({
  newRoot: z.string(),
  from: z.string(),
  to: z.string(),
});

export type FsCpResponse = z.infer<typeof FsCpResponseSchema>;

// ============================================================================
// rewrite
// ============================================================================

/**
 * A single rewrite entry value.
 *
 * Exactly one of `from`, `dir`, or `link` must be set.
 */
export const FsRewriteEntrySchema = z.union([
  /** Reference a path in the original tree (move/copy source) */
  z.object({ from: z.string().min(1) }),
  /** Create an empty directory */
  z.object({ dir: z.literal(true) }),
  /** Mount an existing CAS node by key */
  z.object({
    link: z.string().regex(NODE_KEY_REGEX, "Invalid node key format"),
    /** Optional index-path proof that the node is within Token scope */
    proof: z.string().optional(),
  }),
]);

export type FsRewriteEntry = z.infer<typeof FsRewriteEntrySchema>;

/** Request body for POST .../fs/rewrite */
export const FsRewriteRequestSchema = z
  .object({
    /** Path → entry mappings describing the new tree */
    entries: z.record(z.string(), FsRewriteEntrySchema).optional(),
    /** Paths to remove from the tree */
    deletes: z.array(z.string()).optional(),
  })
  .refine(
    (d) => (d.entries && Object.keys(d.entries).length > 0) || (d.deletes && d.deletes.length > 0),
    { message: "entries and deletes cannot both be empty" }
  )
  .refine(
    (d) => Object.keys(d.entries ?? {}).length + (d.deletes?.length ?? 0) <= FS_MAX_REWRITE_ENTRIES,
    { message: `Total entries + deletes must not exceed ${FS_MAX_REWRITE_ENTRIES}` }
  );

export type FsRewriteRequest = z.infer<typeof FsRewriteRequestSchema>;

/** Response for POST .../fs/rewrite */
export const FsRewriteResponseSchema = z.object({
  newRoot: z.string(),
  /** Number of entries actually applied */
  entriesApplied: z.number().int().nonnegative(),
  /** Number of paths actually deleted */
  deleted: z.number().int().nonnegative(),
});

export type FsRewriteResponse = z.infer<typeof FsRewriteResponseSchema>;

// ============================================================================
// Filesystem error codes
// ============================================================================

/** nodeKey 无效或引用的节点不存在 */
export const FS_INVALID_ROOT = "INVALID_ROOT";

/** 路径不存在 */
export const FS_PATH_NOT_FOUND = "PATH_NOT_FOUND";

/** 路径中间节点不是目录 */
export const FS_NOT_A_DIRECTORY = "NOT_A_DIRECTORY";

/** 目标不是文件 */
export const FS_NOT_A_FILE = "NOT_A_FILE";

/** indexPath 中的索引超出范围 */
export const FS_INDEX_OUT_OF_BOUNDS = "INDEX_OUT_OF_BOUNDS";

/** 根节点不在 Token scope 内 */
export const FS_NODE_NOT_IN_SCOPE = "NODE_NOT_IN_SCOPE";

/** 文件有 successor 节点（多 block）*/
export const FS_FILE_TOO_LARGE = "FILE_TOO_LARGE";

/** 实际 body 字节数与 Content-Length 不一致 */
export const FS_CONTENT_LENGTH_MISMATCH = "CONTENT_LENGTH_MISMATCH";

/** 路径无效（空段、非法字符等）*/
export const FS_INVALID_PATH = "INVALID_PATH";

/** 文件/目录名超过 maxNameBytes */
export const FS_NAME_TOO_LONG = "NAME_TOO_LONG";

/** 目录子节点数达到上限 */
export const FS_COLLECTION_FULL = "COLLECTION_FULL";

/** 目标路径已存在且是文件 */
export const FS_EXISTS_AS_FILE = "EXISTS_AS_FILE";

/** 不能删除根节点 */
export const FS_CANNOT_REMOVE_ROOT = "CANNOT_REMOVE_ROOT";

/** 目标路径已存在文件 */
export const FS_TARGET_EXISTS = "TARGET_EXISTS";

/** 不能移动根节点 */
export const FS_CANNOT_MOVE_ROOT = "CANNOT_MOVE_ROOT";

/** 不能将目录移入自身或其子目录 */
export const FS_MOVE_INTO_SELF = "MOVE_INTO_SELF";

/** entries 和 deletes 都为空 */
export const FS_EMPTY_REWRITE = "EMPTY_REWRITE";

/** entries + deletes 条目总数超限 */
export const FS_TOO_MANY_ENTRIES = "TOO_MANY_ENTRIES";

/** link 引用验证失败 */
export const FS_LINK_NOT_AUTHORIZED = "LINK_NOT_AUTHORIZED";
