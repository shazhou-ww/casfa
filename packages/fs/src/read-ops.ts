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
import type {
  FsTreeDir,
  FsTreeFile,
  FsTreeNode,
  FsTreeOptions,
  FsTreeResponse,
} from "./tree-types.ts";
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

    // Collect storage keys for the current page
    const pageKeys: string[] = [];
    for (let i = startIndex; i < endIndex; i++) {
      pageKeys.push(hashToStorageKey(childHashes[i]!));
    }

    // Try batch metadata lookup first (avoids per-child S3 fetches)
    const metaMap = ctx.getChildrenMeta ? await ctx.getChildrenMeta(pageKeys) : null;

    const children: FsLsChild[] = [];
    for (let idx = 0; idx < pageKeys.length; idx++) {
      const i = startIndex + idx;
      const childName = childNames[i]!;
      const childStorageKey = pageKeys[idx]!;

      const child: FsLsChild = {
        name: childName,
        index: i,
        type: "file",
        key: storageKeyToNodeKey(childStorageKey),
        size: null,
        contentType: null,
        childCount: null,
      };

      // Use batch metadata when available
      const meta = metaMap?.get(childStorageKey);
      if (meta) {
        child.type = meta.kind === "dict" ? "dir" : "file";
        child.size = meta.size;
        child.contentType = meta.contentType;
        child.childCount = meta.childCount;
      } else {
        // Fallback: fetch and decode the child node individually
        const childNode = await tree.getAndDecodeNode(childStorageKey);
        if (childNode) {
          child.type = childNode.kind === "dict" ? "dir" : "file";
          if (childNode.kind === "dict") {
            child.childCount = childNode.children?.length ?? 0;
          } else if (childNode.kind === "file") {
            child.size = childNode.fileInfo?.fileSize ?? childNode.data?.length ?? 0;
            child.contentType = childNode.fileInfo?.contentType ?? "application/octet-stream";
          }
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

// ============================================================================
// Tree: BFS with budget-based truncation
// ============================================================================

/** Default and max constants for tree() */
const TREE_DEFAULT_DEPTH = 3;
const TREE_DEFAULT_MAX_ENTRIES = 500;
const TREE_MAX_ENTRIES_CAP = 5000;

/**
 * Build a recursive directory tree using BFS with budget truncation.
 *
 * Algorithm:
 *  1. Resolve the starting node (optionally following a path).
 *  2. BFS through directory nodes, decoding each to populate children.
 *  3. Track a running `budget` of remaining entries.
 *  4. When a directory's child count exceeds the remaining budget,
 *     mark it and all subsequent same-depth nodes as `collapsed: true`.
 *  5. Directories beyond `maxDepth` are also marked collapsed.
 */
export const buildTree = async (
  ctx: FsContext,
  treeOps: TreeOps,
  rootNodeKey: string,
  opts: FsTreeOptions = {}
): Promise<FsTreeResponse | FsError> => {
  const rootKey = await treeOps.resolveNodeKey(rootNodeKey);
  if (typeof rootKey === "object") return rootKey;

  // If a path is provided, resolve it first
  const segments = opts.path;
  const resolved = segments
    ? await treeOps.resolvePath(rootKey, segments)
    : await treeOps.resolvePath(rootKey, []);
  if ("code" in resolved) return resolved;

  const { hash, node } = resolved;

  if (node.kind !== "dict") {
    return fsError("NOT_A_DIRECTORY", 400, "Target is not a directory");
  }

  const maxDepth = opts.depth ?? TREE_DEFAULT_DEPTH;
  const maxEntries = Math.min(
    Math.max(opts.maxEntries ?? TREE_DEFAULT_MAX_ENTRIES, 1),
    TREE_MAX_ENTRIES_CAP
  );

  let budget = maxEntries;
  let truncated = false;

  // The root tree node
  const rootTreeNode: FsTreeDir = {
    hash: storageKeyToNodeKey(hash),
    kind: "dir",
    count: node.children?.length ?? 0,
  };

  // BFS queue entry: the mutable FsTreeDir object + its CAS children data + depth
  type BfsEntry = {
    treeDir: FsTreeDir;
    childNames: string[];
    childHashes: Uint8Array[];
    depth: number;
  };

  const queue: BfsEntry[] = [];

  // Enqueue root if within depth limit
  if (maxDepth === -1 || maxDepth > 0) {
    const childNames = node.childNames ?? [];
    const childHashes = node.children ?? [];

    if (childNames.length <= budget) {
      budget -= childNames.length;
      queue.push({
        treeDir: rootTreeNode,
        childNames,
        childHashes,
        depth: 0,
      });
    } else {
      rootTreeNode.collapsed = true;
      truncated = true;
    }
  } else {
    rootTreeNode.collapsed = true;
  }

  while (queue.length > 0) {
    const entry = queue.shift()!;
    const { treeDir, childNames, childHashes, depth } = entry;
    const children: Record<string, FsTreeNode> = {};

    for (let i = 0; i < childNames.length; i++) {
      const childName = childNames[i]!;
      const childHashBytes = childHashes[i]!;
      const childStorageKey = hashToStorageKey(childHashBytes);
      const childNode = await treeOps.getAndDecodeNode(childStorageKey);
      const childKey = storageKeyToNodeKey(childStorageKey);

      if (!childNode || childNode.kind !== "dict") {
        // File node (or unreadable node treated as file)
        const file: FsTreeFile = {
          hash: childKey,
          kind: "file",
          type:
            childNode?.kind === "file"
              ? (childNode.fileInfo?.contentType ?? "application/octet-stream")
              : "application/octet-stream",
          size:
            childNode?.kind === "file"
              ? (childNode.fileInfo?.fileSize ?? childNode.data?.length ?? 0)
              : 0,
        };
        children[childName] = file;
      } else {
        // Directory node
        const childCount = childNode.children?.length ?? 0;
        const dir: FsTreeDir = {
          hash: childKey,
          kind: "dir",
          count: childCount,
        };

        const nextDepth = depth + 1;
        const withinDepthLimit = maxDepth === -1 || nextDepth < maxDepth;

        if (withinDepthLimit && childCount <= budget) {
          // Can expand this directory
          budget -= childCount;
          queue.push({
            treeDir: dir,
            childNames: childNode.childNames ?? [],
            childHashes: childNode.children ?? [],
            depth: nextDepth,
          });
        } else {
          // Must collapse: over budget or depth limit
          dir.collapsed = true;
          if (childCount > budget && withinDepthLimit) {
            truncated = true;
            // Collapse all remaining same-depth dirs in the queue too
            for (const q of queue) {
              if (q.depth === entry.depth) {
                // The treeDir was already expanded (its children are being populated),
                // but future same-depth entries in the BFS queue should be marked collapsed.
                // Actually, queue entries at this depth have already had their budget deducted
                // and their treeDir children are being/will be populated.
                // We only need to stop enqueuing NEW children at the NEXT depth.
              }
            }
            // Mark all remaining unprocessed sibling directories in this loop as collapsed
            for (let j = i + 1; j < childNames.length; j++) {
              const sibName = childNames[j]!;
              const sibHashBytes = childHashes[j]!;
              const sibStorageKey = hashToStorageKey(sibHashBytes);
              const sibNode = await treeOps.getAndDecodeNode(sibStorageKey);
              const sibKey = storageKeyToNodeKey(sibStorageKey);

              if (!sibNode || sibNode.kind !== "dict") {
                const file: FsTreeFile = {
                  hash: sibKey,
                  kind: "file",
                  type:
                    sibNode?.kind === "file"
                      ? (sibNode.fileInfo?.contentType ?? "application/octet-stream")
                      : "application/octet-stream",
                  size:
                    sibNode?.kind === "file"
                      ? (sibNode.fileInfo?.fileSize ?? sibNode.data?.length ?? 0)
                      : 0,
                };
                children[sibName] = file;
              } else {
                const sibDir: FsTreeDir = {
                  hash: sibKey,
                  kind: "dir",
                  count: sibNode.children?.length ?? 0,
                  collapsed: true,
                };
                children[sibName] = sibDir;
              }
            }
            break; // Stop processing this directory's children
          }
        }

        children[childName] = dir;
      }
    }

    treeDir.children = children;
  }

  // If truncated, also collapse any remaining queued dirs that haven't been processed
  if (truncated) {
    for (const remaining of queue) {
      remaining.treeDir.collapsed = true;
      delete remaining.treeDir.children;
    }
    queue.length = 0;
  }

  return {
    ...rootTreeNode,
    truncated,
  };
};
