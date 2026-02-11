/**
 * @casfa/fs — Write Operations
 *
 * Mutating filesystem operations: write, mkdir, rm, mv, cp, rewrite.
 * Each operation produces a new immutable root.
 *
 * Note: The `rewrite` operation's `link` entry type requires authorization
 * checks that are server-specific. The `authorizeLink` hook in FsContext
 * allows the server to inject this logic. If not provided, link entries
 * are accepted without authorization (suitable for local-only usage).
 */

import { encodeDictNode, encodeFileNode } from "@casfa/core";
import {
  FS_MAX_NODE_SIZE,
  FS_MAX_REWRITE_ENTRIES,
  type FsCpResponse,
  type FsMkdirResponse,
  type FsMvResponse,
  type FsRewriteEntry,
  type FsRewriteResponse,
  type FsRmResponse,
  type FsWriteResponse,
  nodeKeyToStorageKey,
  storageKeyToNodeKey,
} from "@casfa/protocol";

import { findChildByName, hashToStorageKey, parsePath, storageKeyToHash } from "./helpers.ts";
import type { TreeOps } from "./tree-ops.ts";
import { type FsContext, type FsError, fsError } from "./types.ts";

// ============================================================================
// Types
// ============================================================================

/**
 * Optional authorization hook for rewrite `link` entries.
 * Returns true if the link is authorized, false otherwise.
 */
export type AuthorizeLinkFn = (
  linkStorageKey: string,
  proof?: string,
) => Promise<boolean>;

// ============================================================================
// Write Operations Factory
// ============================================================================

export type WriteOps = ReturnType<typeof createWriteOps>;

export const createWriteOps = (
  ctx: FsContext,
  tree: TreeOps,
  authorizeLink?: AuthorizeLinkFn,
) => {
  const { hash: hashProvider, storage } = ctx;

  /**
   * write — Create or overwrite a single-block file.
   */
  const write = async (
    rootNodeKey: string,
    pathStr: string | undefined,
    indexPathStr: string | undefined,
    fileContent: Uint8Array,
    contentType: string,
  ): Promise<FsWriteResponse | FsError> => {
    if (fileContent.length > FS_MAX_NODE_SIZE) {
      return fsError("FILE_TOO_LARGE", 413, "File exceeds maxNodeSize (4MB). Use the Node API.");
    }

    const rootKey = await tree.resolveNodeKey(rootNodeKey);
    if (typeof rootKey === "object") return rootKey;

    // Encode file node
    const fileEncoded = await encodeFileNode(
      { data: fileContent, contentType, fileSize: fileContent.length },
      hashProvider,
    );

    const fileKey = await tree.storeNode(
      fileEncoded.bytes,
      fileEncoded.hash,
      "file",
      fileContent.length,
    );

    // ---------- indexPath-only overwrite ----------
    if (indexPathStr && !pathStr) {
      const resolved = await tree.resolvePath(rootKey, undefined, indexPathStr);
      if ("code" in resolved) return resolved;

      if (resolved.node.kind !== "file") {
        return fsError(
          "NOT_A_FILE",
          400,
          "Target is not a file (cannot overwrite directory with indexPath)",
        );
      }
      if (resolved.parentPath.length === 0) {
        return fsError("INVALID_PATH", 400, "Cannot replace root node");
      }

      const newRootKey = await tree.rebuildMerklePath(resolved.parentPath, fileEncoded.hash);

      return {
        newRoot: storageKeyToNodeKey(newRootKey),
        file: {
          path: indexPathStr,
          key: storageKeyToNodeKey(fileKey),
          size: fileContent.length,
          contentType,
        },
        created: false,
      };
    }

    // ---------- path-based write ----------
    if (!pathStr) {
      return fsError("INVALID_PATH", 400, "Either path or indexPath is required for write");
    }

    const segments = parsePath(pathStr);
    if ("code" in segments) return segments;
    if (segments.length === 0) {
      return fsError("INVALID_PATH", 400, "Path cannot be empty for write");
    }

    const fileName = segments[segments.length - 1]!;

    if (segments.length === 1) {
      // Writing directly under root
      const rootNode = await tree.getAndDecodeNode(rootKey);
      if (!rootNode) return fsError("INVALID_ROOT", 400, "Root node not found");
      if (rootNode.kind !== "dict")
        return fsError("NOT_A_DIRECTORY", 400, "Root is not a directory");

      const existing = findChildByName(rootNode, fileName);
      if (existing) {
        const existingNode = await tree.getAndDecodeNode(hashToStorageKey(existing.hash));
        if (existingNode?.kind === "dict") {
          return fsError(
            "NOT_A_FILE",
            400,
            `'${fileName}' is a directory, cannot overwrite with file`,
          );
        }

        const newChildren = [...(rootNode.children ?? [])];
        newChildren[existing.index] = fileEncoded.hash;

        const newRootEncoded = await encodeDictNode(
          { children: newChildren, childNames: rootNode.childNames ?? [] },
          hashProvider,
        );
        const newRootKey = await tree.storeNode(
          newRootEncoded.bytes,
          newRootEncoded.hash,
          "dict",
          0,
        );

        return {
          newRoot: storageKeyToNodeKey(newRootKey),
          file: {
            path: pathStr,
            key: storageKeyToNodeKey(fileKey),
            size: fileContent.length,
            contentType,
          },
          created: false,
        };
      }

      // Insert new
      const result = await tree.insertChild([], rootKey, rootNode, fileName, fileEncoded.hash);
      if (typeof result === "object" && "code" in result) return result;

      return {
        newRoot: storageKeyToNodeKey(result),
        file: {
          path: pathStr,
          key: storageKeyToNodeKey(fileKey),
          size: fileContent.length,
          contentType,
        },
        created: true,
      };
    }

    // Multi-segment: ensure parent dirs
    const parentResult = await tree.ensureParentDirs(rootKey, segments);
    if ("code" in parentResult) return parentResult;

    const { parentHash, parentNode, parentPath } = parentResult;
    const existing = findChildByName(parentNode, fileName);
    if (existing) {
      const existingNode = await tree.getAndDecodeNode(hashToStorageKey(existing.hash));
      if (existingNode?.kind === "dict") {
        return fsError(
          "NOT_A_FILE",
          400,
          `'${fileName}' is a directory, cannot overwrite with file`,
        );
      }

      const newChildren = [...(parentNode.children ?? [])];
      newChildren[existing.index] = fileEncoded.hash;

      const newParentEncoded = await encodeDictNode(
        { children: newChildren, childNames: parentNode.childNames ?? [] },
        hashProvider,
      );
      await tree.storeNode(newParentEncoded.bytes, newParentEncoded.hash, "dict", 0);
      const newRootKey = await tree.rebuildMerklePath(parentPath, newParentEncoded.hash);

      return {
        newRoot: storageKeyToNodeKey(newRootKey),
        file: {
          path: pathStr,
          key: storageKeyToNodeKey(fileKey),
          size: fileContent.length,
          contentType,
        },
        created: false,
      };
    }

    const result = await tree.insertChild(
      parentPath,
      parentHash,
      parentNode,
      fileName,
      fileEncoded.hash,
    );
    if (typeof result === "object" && "code" in result) return result;

    return {
      newRoot: storageKeyToNodeKey(result),
      file: {
        path: pathStr,
        key: storageKeyToNodeKey(fileKey),
        size: fileContent.length,
        contentType,
      },
      created: true,
    };
  };

  /**
   * mkdir — Create a directory (with implicit parent creation).
   */
  const mkdir = async (
    rootNodeKey: string,
    pathStr: string,
  ): Promise<FsMkdirResponse | FsError> => {
    const rootKey = await tree.resolveNodeKey(rootNodeKey);
    if (typeof rootKey === "object") return rootKey;

    const segments = parsePath(pathStr);
    if ("code" in segments) return segments;
    if (segments.length === 0) {
      return fsError("INVALID_PATH", 400, "Path cannot be empty for mkdir");
    }

    // Check if already exists
    const existing = await tree.resolvePath(rootKey, pathStr);
    if (!("code" in existing)) {
      if (existing.node.kind === "dict") {
        return {
          newRoot: storageKeyToNodeKey(rootKey),
          dir: { path: pathStr, key: storageKeyToNodeKey(existing.hash) },
          created: false,
        };
      }
      return fsError("EXISTS_AS_FILE", 409, `Path '${pathStr}' already exists as a file`);
    }

    const emptyDirEncoded = await encodeDictNode({ children: [], childNames: [] }, hashProvider);
    await tree.storeNode(emptyDirEncoded.bytes, emptyDirEncoded.hash, "dict", 0);
    const dirKey = hashToStorageKey(emptyDirEncoded.hash);
    const dirName = segments[segments.length - 1]!;

    if (segments.length === 1) {
      const rootNode = await tree.getAndDecodeNode(rootKey);
      if (!rootNode) return fsError("INVALID_ROOT", 400, "Root node not found");
      if (rootNode.kind !== "dict")
        return fsError("NOT_A_DIRECTORY", 400, "Root is not a directory");

      const result = await tree.insertChild(
        [],
        rootKey,
        rootNode,
        dirName,
        emptyDirEncoded.hash,
      );
      if (typeof result === "object" && "code" in result) return result;

      return {
        newRoot: storageKeyToNodeKey(result),
        dir: { path: pathStr, key: storageKeyToNodeKey(dirKey) },
        created: true,
      };
    }

    const parentResult = await tree.ensureParentDirs(rootKey, segments);
    if ("code" in parentResult) return parentResult;

    const { parentHash, parentNode, parentPath } = parentResult;
    const result = await tree.insertChild(
      parentPath,
      parentHash,
      parentNode,
      dirName,
      emptyDirEncoded.hash,
    );
    if (typeof result === "object" && "code" in result) return result;

    return {
      newRoot: storageKeyToNodeKey(result),
      dir: { path: pathStr, key: storageKeyToNodeKey(dirKey) },
      created: true,
    };
  };

  /**
   * rm — Remove a file or directory.
   */
  const rm = async (
    rootNodeKey: string,
    pathStr?: string,
    indexPathStr?: string,
  ): Promise<FsRmResponse | FsError> => {
    const rootKey = await tree.resolveNodeKey(rootNodeKey);
    if (typeof rootKey === "object") return rootKey;

    if (!pathStr && !indexPathStr) {
      return fsError("CANNOT_REMOVE_ROOT", 400, "Cannot remove root node. Specify a sub-path.");
    }

    const resolved = await tree.resolvePath(rootKey, pathStr, indexPathStr);
    if ("code" in resolved) return resolved;

    if (resolved.parentPath.length === 0) {
      return fsError("CANNOT_REMOVE_ROOT", 400, "Cannot remove root node");
    }

    const lastParent = resolved.parentPath[resolved.parentPath.length - 1]!;
    const newRootKey = await tree.removeChild(
      resolved.parentPath.slice(0, -1),
      lastParent.node,
      lastParent.childIndex,
    );

    return {
      newRoot: storageKeyToNodeKey(newRootKey),
      removed: {
        path: pathStr ?? indexPathStr ?? "",
        type: resolved.node.kind === "dict" ? "dir" : "file",
        key: storageKeyToNodeKey(resolved.hash),
      },
    };
  };

  /**
   * mv — Move / rename a file or directory.
   */
  const mv = async (
    rootNodeKey: string,
    fromPath: string,
    toPath: string,
  ): Promise<FsMvResponse | FsError> => {
    const rootKey = await tree.resolveNodeKey(rootNodeKey);
    if (typeof rootKey === "object") return rootKey;

    const fromSegments = parsePath(fromPath);
    if ("code" in fromSegments) return fromSegments;
    if (fromSegments.length === 0) return fsError("CANNOT_MOVE_ROOT", 400, "Cannot move root node");

    const toSegments = parsePath(toPath);
    if ("code" in toSegments) return toSegments;
    if (toSegments.length === 0) return fsError("INVALID_PATH", 400, "Target path cannot be empty");

    if (toPath.startsWith(`${fromPath}/`)) {
      return fsError(
        "MOVE_INTO_SELF",
        400,
        "Cannot move a directory into itself or its subdirectory",
      );
    }

    const source = await tree.resolvePath(rootKey, fromPath);
    if ("code" in source) return source;

    const sourceNodeHash = storageKeyToHash(source.hash);

    if (source.parentPath.length === 0) {
      return fsError("CANNOT_MOVE_ROOT", 400, "Cannot move root node");
    }

    const lastParent = source.parentPath[source.parentPath.length - 1]!;
    const afterRemoveRootKey = await tree.removeChild(
      source.parentPath.slice(0, -1),
      lastParent.node,
      lastParent.childIndex,
    );

    const toName = toSegments[toSegments.length - 1]!;

    // Check if target exists in the new tree
    const targetCheck = await tree.resolvePath(afterRemoveRootKey, toPath);
    if (!("code" in targetCheck)) {
      if (targetCheck.node.kind === "dict" && source.node.kind !== "dict") {
        const result = await tree.insertChild(
          targetCheck.parentPath,
          targetCheck.hash,
          targetCheck.node,
          source.name,
          sourceNodeHash,
        );
        if (typeof result === "object" && "code" in result) return result;
        return {
          newRoot: storageKeyToNodeKey(result),
          from: fromPath,
          to: `${toPath}/${source.name}`,
        };
      }
      return fsError("TARGET_EXISTS", 409, `Target path already exists: ${toPath}`);
    }

    if (toSegments.length === 1) {
      const rootNode = await tree.getAndDecodeNode(afterRemoveRootKey);
      if (!rootNode) return fsError("INVALID_ROOT", 400, "Root node not found after remove");
      if (rootNode.kind !== "dict")
        return fsError("NOT_A_DIRECTORY", 400, "Root is not a directory");

      const result = await tree.insertChild(
        [],
        afterRemoveRootKey,
        rootNode,
        toName,
        sourceNodeHash,
      );
      if (typeof result === "object" && "code" in result) return result;
      return { newRoot: storageKeyToNodeKey(result), from: fromPath, to: toPath };
    }

    const parentResult = await tree.ensureParentDirs(afterRemoveRootKey, toSegments);
    if ("code" in parentResult) return parentResult;

    const result = await tree.insertChild(
      parentResult.parentPath,
      parentResult.parentHash,
      parentResult.parentNode,
      toName,
      sourceNodeHash,
    );
    if (typeof result === "object" && "code" in result) return result;

    return { newRoot: storageKeyToNodeKey(result), from: fromPath, to: toPath };
  };

  /**
   * cp — Copy a file or directory (shallow — CAS deduplication handles it).
   */
  const cp = async (
    rootNodeKey: string,
    fromPath: string,
    toPath: string,
  ): Promise<FsCpResponse | FsError> => {
    const rootKey = await tree.resolveNodeKey(rootNodeKey);
    if (typeof rootKey === "object") return rootKey;

    const toSegments = parsePath(toPath);
    if ("code" in toSegments) return toSegments;
    if (toSegments.length === 0) return fsError("INVALID_PATH", 400, "Target path cannot be empty");

    const source = await tree.resolvePath(rootKey, fromPath);
    if ("code" in source) return source;

    const targetCheck = await tree.resolvePath(rootKey, toPath);
    if (!("code" in targetCheck)) {
      return fsError("TARGET_EXISTS", 409, `Target path already exists: ${toPath}`);
    }

    const sourceNodeHash = storageKeyToHash(source.hash);
    const toName = toSegments[toSegments.length - 1]!;

    if (toSegments.length === 1) {
      const rootNode = await tree.getAndDecodeNode(rootKey);
      if (!rootNode) return fsError("INVALID_ROOT", 400, "Root node not found");
      if (rootNode.kind !== "dict")
        return fsError("NOT_A_DIRECTORY", 400, "Root is not a directory");

      const result = await tree.insertChild([], rootKey, rootNode, toName, sourceNodeHash);
      if (typeof result === "object" && "code" in result) return result;
      return { newRoot: storageKeyToNodeKey(result), from: fromPath, to: toPath };
    }

    const parentResult = await tree.ensureParentDirs(rootKey, toSegments);
    if ("code" in parentResult) return parentResult;

    const result = await tree.insertChild(
      parentResult.parentPath,
      parentResult.parentHash,
      parentResult.parentNode,
      toName,
      sourceNodeHash,
    );
    if (typeof result === "object" && "code" in result) return result;
    return { newRoot: storageKeyToNodeKey(result), from: fromPath, to: toPath };
  };

  /**
   * rewrite — Declarative batch rewrite (entries + deletes).
   */
  const rewrite = async (
    rootNodeKey: string,
    entries?: Record<string, FsRewriteEntry>,
    deletes?: string[],
  ): Promise<FsRewriteResponse | FsError> => {
    const rootKey = await tree.resolveNodeKey(rootNodeKey);
    if (typeof rootKey === "object") return rootKey;

    const entryCount = entries ? Object.keys(entries).length : 0;
    const deleteCount = deletes?.length ?? 0;

    if (entryCount === 0 && deleteCount === 0) {
      return fsError("EMPTY_REWRITE", 400, "entries and deletes cannot both be empty");
    }
    if (entryCount + deleteCount > FS_MAX_REWRITE_ENTRIES) {
      return fsError(
        "TOO_MANY_ENTRIES",
        400,
        `Total entries + deletes exceeds ${FS_MAX_REWRITE_ENTRIES}`,
      );
    }

    let currentRootKey = rootKey;
    const originalRootKey = rootKey;

    // Phase 1: deletes
    let actualDeleted = 0;
    if (deletes && deletes.length > 0) {
      for (const deletePath of deletes) {
        const pathSegments = parsePath(deletePath);
        if ("code" in pathSegments) return pathSegments;

        const resolved = await tree.resolvePath(currentRootKey, deletePath);
        if ("code" in resolved) continue; // skip non-existent

        if (resolved.parentPath.length === 0) {
          return fsError("CANNOT_REMOVE_ROOT", 400, "Cannot delete root path");
        }

        const lastParent = resolved.parentPath[resolved.parentPath.length - 1]!;
        currentRootKey = await tree.removeChild(
          resolved.parentPath.slice(0, -1),
          lastParent.node,
          lastParent.childIndex,
        );
        actualDeleted++;
      }
    }

    // Phase 2: entries
    let actualApplied = 0;
    if (entries) {
      for (const [targetPath, entry] of Object.entries(entries)) {
        const targetSegments = parsePath(targetPath);
        if ("code" in targetSegments) return targetSegments;
        if (targetSegments.length === 0) {
          return fsError("INVALID_PATH", 400, "Empty target path in entries");
        }

        let nodeHash: Uint8Array;

        if ("from" in entry) {
          const source = await tree.resolvePath(originalRootKey, entry.from);
          if ("code" in source) {
            return fsError(
              "PATH_NOT_FOUND",
              404,
              `Entry '${targetPath}' references non-existent source path`,
              { entry: targetPath, from: entry.from },
            );
          }
          nodeHash = storageKeyToHash(source.hash);
        } else if ("dir" in entry) {
          const emptyEncoded = await encodeDictNode({ children: [], childNames: [] }, hashProvider);
          await tree.storeNode(emptyEncoded.bytes, emptyEncoded.hash, "dict", 0);
          nodeHash = emptyEncoded.hash;
        } else if ("link" in entry) {
          const linkKey = entry.link;
          if (!linkKey.startsWith("nod_")) {
            return fsError("INVALID_PATH", 400, `Invalid link key format: ${linkKey}`);
          }
          const linkStorageKey = nodeKeyToStorageKey(linkKey);

          const exists = await storage.has(linkStorageKey);
          if (!exists) {
            return fsError("NODE_NOT_FOUND", 404, `Linked node not found: ${linkKey}`);
          }

          // Authorization check via hook
          if (authorizeLink) {
            const authorized = await authorizeLink(linkStorageKey, entry.proof);
            if (!authorized) {
              return fsError(
                "LINK_NOT_AUTHORIZED",
                403,
                `Not authorized to reference node: ${linkKey}. Upload the node first or provide a valid proof.`,
              );
            }
          }

          nodeHash = storageKeyToHash(linkStorageKey);
        } else {
          return fsError("INVALID_PATH", 400, `Invalid entry type for '${targetPath}'`);
        }

        // Insert / replace at target path
        const targetName = targetSegments[targetSegments.length - 1]!;

        if (targetSegments.length === 1) {
          const rootNode = await tree.getAndDecodeNode(currentRootKey);
          if (!rootNode) return fsError("INVALID_ROOT", 400, "Root node not found");
          if (rootNode.kind !== "dict")
            return fsError("NOT_A_DIRECTORY", 400, "Root is not a directory");

          const existingChild = findChildByName(rootNode, targetName);
          if (existingChild) {
            const newChildren = [...(rootNode.children ?? [])];
            newChildren[existingChild.index] = nodeHash;
            const encoded = await encodeDictNode(
              { children: newChildren, childNames: rootNode.childNames ?? [] },
              hashProvider,
            );
            currentRootKey = await tree.storeNode(encoded.bytes, encoded.hash, "dict", 0);
          } else {
            const result = await tree.insertChild(
              [],
              currentRootKey,
              rootNode,
              targetName,
              nodeHash,
            );
            if (typeof result === "object" && "code" in result) return result;
            currentRootKey = result;
          }
        } else {
          const parentResult = await tree.ensureParentDirs(currentRootKey, targetSegments);
          if ("code" in parentResult) return parentResult;

          const { parentHash, parentNode, parentPath } = parentResult;
          const existingChild = findChildByName(parentNode, targetName);
          if (existingChild) {
            const newChildren = [...(parentNode.children ?? [])];
            newChildren[existingChild.index] = nodeHash;
            const encoded = await encodeDictNode(
              { children: newChildren, childNames: parentNode.childNames ?? [] },
              hashProvider,
            );
            await tree.storeNode(encoded.bytes, encoded.hash, "dict", 0);
            currentRootKey = await tree.rebuildMerklePath(parentPath, encoded.hash);
          } else {
            const result = await tree.insertChild(
              parentPath,
              parentHash,
              parentNode,
              targetName,
              nodeHash,
            );
            if (typeof result === "object" && "code" in result) return result;
            currentRootKey = result;
          }
        }

        actualApplied++;
      }
    }

    return {
      newRoot: storageKeyToNodeKey(currentRootKey),
      entriesApplied: actualApplied,
      deleted: actualDeleted,
    };
  };

  return { write, mkdir, rm, mv, cp, rewrite };
};
