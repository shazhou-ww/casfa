/**
 * Filesystem Service — Read Operations
 *
 * Read-only filesystem operations: stat, read, ls.
 */

import type { FsLsChild, FsLsResponse, FsStatResponse } from "@casfa/protocol";
import { hashToHex, hexToNodeKey } from "./helpers.ts";
import type { TreeOps } from "./tree-ops.ts";
import type { FsError } from "./types.ts";
import { fsError } from "./types.ts";

// ============================================================================
// Read Operations Factory
// ============================================================================

export type ReadOps = ReturnType<typeof createReadOps>;

export const createReadOps = (tree: TreeOps) => {
  /**
   * stat — Get file / directory metadata.
   */
  const stat = async (
    realm: string,
    rootNodeKey: string,
    pathStr?: string,
    indexPathStr?: string
  ): Promise<FsStatResponse | FsError> => {
    const rootHex = await tree.resolveNodeKey(realm, rootNodeKey);
    if (typeof rootHex === "object") return rootHex;

    const resolved = await tree.resolvePath(rootHex, pathStr, indexPathStr);
    if ("code" in resolved) return resolved;

    const { hash, node, name } = resolved;

    if (node.kind === "dict") {
      return {
        type: "dir",
        name,
        key: hexToNodeKey(hash),
        childCount: node.children?.length ?? 0,
      };
    }
    if (node.kind === "file") {
      return {
        type: "file",
        name,
        key: hexToNodeKey(hash),
        size: node.fileInfo?.fileSize ?? node.size,
        contentType: node.fileInfo?.contentType ?? "application/octet-stream",
      };
    }

    // successor nodes are also files
    return {
      type: "file",
      name,
      key: hexToNodeKey(hash),
      size: node.size,
      contentType: "application/octet-stream",
    };
  };

  /**
   * read — Read single-block file content.
   */
  const read = async (
    realm: string,
    rootNodeKey: string,
    pathStr?: string,
    indexPathStr?: string
  ): Promise<{ data: Uint8Array; contentType: string; size: number; key: string } | FsError> => {
    const rootHex = await tree.resolveNodeKey(realm, rootNodeKey);
    if (typeof rootHex === "object") return rootHex;

    const resolved = await tree.resolvePath(rootHex, pathStr, indexPathStr);
    if ("code" in resolved) return resolved;

    const { hash, node } = resolved;

    if (node.kind === "dict") {
      return fsError("NOT_A_FILE", 400, "Target is a directory, not a file");
    }
    if (node.kind !== "file") {
      return fsError("NOT_A_FILE", 400, "Target is not a file node");
    }
    if (node.children && node.children.length > 0) {
      return fsError(
        "FILE_TOO_LARGE",
        400,
        "File has successor nodes (multi-block). Use the Node API to read."
      );
    }

    return {
      data: node.data ?? new Uint8Array(0),
      contentType: node.fileInfo?.contentType ?? "application/octet-stream",
      size: node.fileInfo?.fileSize ?? node.data?.length ?? 0,
      key: hexToNodeKey(hash),
    };
  };

  /**
   * ls — List directory contents with pagination.
   */
  const ls = async (
    realm: string,
    rootNodeKey: string,
    pathStr?: string,
    indexPathStr?: string,
    limit = 100,
    cursor?: string
  ): Promise<FsLsResponse | FsError> => {
    const rootHex = await tree.resolveNodeKey(realm, rootNodeKey);
    if (typeof rootHex === "object") return rootHex;

    const resolved = await tree.resolvePath(rootHex, pathStr, indexPathStr);
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
      const childHex = hashToHex(childHashBytes);
      const childNode = await tree.getAndDecodeNode(childHex);

      const child: FsLsChild = {
        name: childName,
        index: i,
        type: childNode?.kind === "dict" ? "dir" : "file",
        key: hexToNodeKey(childHex),
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
      path: pathStr ?? "",
      key: hexToNodeKey(hash),
      children,
      total,
      nextCursor: endIndex < total ? String(endIndex) : null,
    };
  };

  return { stat, read, ls };
};
