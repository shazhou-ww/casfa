/**
 * @casfa/fs — Read Operations
 *
 * Read-only filesystem operations: stat, read, readStream, ls.
 * Depends only on TreeOps (which depends only on FsContext).
 */

import type { PathSegment } from "@casfa/cas-uri";
import { INDEX_SEGMENT_PREFIX } from "@casfa/cas-uri";
import type { FsLsChild, FsLsResponse, FsStatResponse } from "@casfa/protocol";
import { storageKeyToNodeKey } from "@casfa/protocol";
import { hashToStorageKey } from "./helpers.ts";
import { readLargeFile, streamLargeFile } from "./large-file.ts";
import type { TreeOps } from "./tree-ops.ts";
import { type FsContext, type FsError, fsError } from "./types.ts";

// ============================================================================
// Read Operations Factory
// ============================================================================

export type ReadOps = ReturnType<typeof createReadOps>;

export const createReadOps = (ctx: FsContext, tree: TreeOps) => {
  /**
   * stat — Get file / directory metadata.
   */
  const stat = async (
    rootNodeKey: string,
    segments: PathSegment[] = []
  ): Promise<FsStatResponse | FsError> => {
    const rootKey = await tree.resolveNodeKey(rootNodeKey);
    if (typeof rootKey === "object") return rootKey;

    const resolved = await tree.resolvePath(rootKey, segments);
    if ("code" in resolved) return resolved;

    const { hash, node, name } = resolved;

    if (node.kind === "dict") {
      return {
        type: "dir",
        name,
        key: storageKeyToNodeKey(hash),
        size: null,
        contentType: null,
        childCount: node.children?.length ?? 0,
      };
    }
    if (node.kind === "file") {
      return {
        type: "file",
        name,
        key: storageKeyToNodeKey(hash),
        size: node.fileInfo?.fileSize ?? node.size,
        contentType: node.fileInfo?.contentType ?? "application/octet-stream",
        childCount: null,
      };
    }

    // successor nodes are also files
    return {
      type: "file",
      name,
      key: storageKeyToNodeKey(hash),
      size: node.size,
      contentType: "application/octet-stream",
      childCount: null,
    };
  };

  /**
   * read — Read file content (supports both single-block and multi-block files).
   *
   * For single-block files, returns the data directly from the node.
   * For multi-block files (B-Tree), reassembles the full content via
   * `@casfa/core`'s `readFile` traversal.
   *
   * Note: For very large files, prefer `readStream` to avoid loading the
   * entire file into memory.
   */
  const read = async (
    rootNodeKey: string,
    segments: PathSegment[] = []
  ): Promise<{ data: Uint8Array; contentType: string; size: number; key: string } | FsError> => {
    const rootKey = await tree.resolveNodeKey(rootNodeKey);
    if (typeof rootKey === "object") return rootKey;

    const resolved = await tree.resolvePath(rootKey, segments);
    if ("code" in resolved) return resolved;

    const { hash, node } = resolved;

    if (node.kind === "dict") {
      return fsError("NOT_A_FILE", 400, "Target is a directory, not a file");
    }
    if (node.kind !== "file") {
      return fsError("NOT_A_FILE", 400, "Target is not a file node");
    }

    const contentType = node.fileInfo?.contentType ?? "application/octet-stream";
    const fileSize = node.fileInfo?.fileSize ?? node.data?.length ?? 0;

    if (node.children && node.children.length > 0) {
      // Multi-block file — reassemble via B-Tree traversal
      const fullData = await readLargeFile(ctx, hash);
      if (!fullData) {
        return fsError("READ_FAILED", 500, "Failed to read multi-block file data");
      }
      return {
        data: fullData,
        contentType,
        size: fileSize,
        key: storageKeyToNodeKey(hash),
      };
    }

    // Single-block file — return data directly
    return {
      data: node.data ?? new Uint8Array(0),
      contentType,
      size: fileSize,
      key: storageKeyToNodeKey(hash),
    };
  };

  /**
   * readStream — Read file content as a ReadableStream.
   *
   * Works for both single-block and multi-block files. For large files,
   * this is more memory-efficient than `read` as it streams data
   * chunk-by-chunk without loading the entire file into memory.
   */
  const readStream = async (
    rootNodeKey: string,
    segments: PathSegment[] = []
  ): Promise<
    { stream: ReadableStream<Uint8Array>; contentType: string; size: number; key: string } | FsError
  > => {
    const rootKey = await tree.resolveNodeKey(rootNodeKey);
    if (typeof rootKey === "object") return rootKey;

    const resolved = await tree.resolvePath(rootKey, segments);
    if ("code" in resolved) return resolved;

    const { hash, node } = resolved;

    if (node.kind === "dict") {
      return fsError("NOT_A_FILE", 400, "Target is a directory, not a file");
    }
    if (node.kind !== "file") {
      return fsError("NOT_A_FILE", 400, "Target is not a file node");
    }

    const contentType = node.fileInfo?.contentType ?? "application/octet-stream";
    const fileSize = node.fileInfo?.fileSize ?? node.data?.length ?? 0;

    // Use streamLargeFile for both single-block and multi-block —
    // it handles both transparently via B-Tree DFS traversal.
    const stream = streamLargeFile(ctx, hash);

    return {
      stream,
      contentType,
      size: fileSize,
      key: storageKeyToNodeKey(hash),
    };
  };

  /**
   * ls — List directory contents with pagination.
   */
  const ls = async (
    rootNodeKey: string,
    segments: PathSegment[] = [],
    limit = 100,
    cursor?: string
  ): Promise<FsLsResponse | FsError> => {
    const rootKey = await tree.resolveNodeKey(rootNodeKey);
    if (typeof rootKey === "object") return rootKey;

    const resolved = await tree.resolvePath(rootKey, segments);
    if ("code" in resolved) return resolved;

    const { hash, node } = resolved;

    if (node.kind !== "dict") {
      return fsError("NOT_A_DIRECTORY", 400, "Target is not a directory");
    }

    const childNames = node.childNames ?? [];
    const childHashes = node.children ?? [];
    const total = childNames.length;

    const startIndex = cursor ? Number.parseInt(cursor, 10) : 0;
    const clampedLimit = Math.min(Math.max(limit, 1), 1000);
    const endIndex = Math.min(startIndex + clampedLimit, total);

    const children: FsLsChild[] = [];
    for (let i = startIndex; i < endIndex; i++) {
      const childName = childNames[i]!;
      const childHashBytes = childHashes[i]!;
      const childStorageKey = hashToStorageKey(childHashBytes);
      const childNode = await tree.getAndDecodeNode(childStorageKey);

      const child: FsLsChild = {
        name: childName,
        index: i,
        type: childNode?.kind === "dict" ? "dir" : "file",
        key: storageKeyToNodeKey(childStorageKey),
        size: null,
        contentType: null,
        childCount: null,
      };

      if (childNode) {
        if (childNode.kind === "dict") {
          child.childCount = childNode.children?.length ?? 0;
        } else if (childNode.kind === "file") {
          child.size = childNode.fileInfo?.fileSize ?? childNode.data?.length ?? 0;
          child.contentType = childNode.fileInfo?.contentType ?? "application/octet-stream";
        }
      }

      children.push(child);
    }

    return {
      path: segments
        .map((s) => (s.kind === "name" ? s.value : `${INDEX_SEGMENT_PREFIX}${s.value}`))
        .join("/"),
      key: storageKeyToNodeKey(hash),
      children,
      total,
      nextCursor: endIndex < total ? String(endIndex) : null,
    };
  };

  return { stat, read, readStream, ls };
};
