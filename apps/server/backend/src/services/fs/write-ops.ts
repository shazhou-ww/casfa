/**
 * Filesystem Service — Write Operations
 *
 * Mutating filesystem operations: write, mkdir, rm, mv, cp, rewrite.
 * Each operation produces a new immutable root.
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
  nodeKeyToHex,
} from "@casfa/protocol";
import type { AccessTokenAuthContext } from "../../types.ts";
import { type ScopeProofDeps, validateProofAgainstScope } from "../../util/scope-proof.ts";
import { findChildByName, hashToHex, hexToHash, hexToNodeKey, parsePath } from "./helpers.ts";
import type { TreeOps } from "./tree-ops.ts";
import type { FsError, FsServiceDeps } from "./types.ts";
import { fsError } from "./types.ts";

// ============================================================================
// Write Operations Factory
// ============================================================================

export type WriteOps = ReturnType<typeof createWriteOps>;

export const createWriteOps = (deps: FsServiceDeps, tree: TreeOps) => {
  const { storage, hashProvider, ownershipV2Db } = deps;

  /**
   * write — Create or overwrite a single-block file.
   */
  const write = async (
    realm: string,
    ownerId: string,
    rootNodeKey: string,
    pathStr: string | undefined,
    indexPathStr: string | undefined,
    fileContent: Uint8Array,
    contentType: string
  ): Promise<FsWriteResponse | FsError> => {
    if (fileContent.length > FS_MAX_NODE_SIZE) {
      return fsError("FILE_TOO_LARGE", 413, "File exceeds maxNodeSize (4MB). Use the Node API.");
    }

    const rootHex = await tree.resolveNodeKey(realm, rootNodeKey);
    if (typeof rootHex === "object") return rootHex;

    // Encode file node
    const fileEncoded = await encodeFileNode(
      { data: fileContent, contentType, fileSize: fileContent.length },
      hashProvider
    );

    const fileHex = await tree.storeNode(
      realm,
      ownerId,
      fileEncoded.bytes,
      fileEncoded.hash,
      "file",
      fileContent.length
    );

    // ---------- indexPath-only overwrite ----------
    if (indexPathStr && !pathStr) {
      const resolved = await tree.resolvePath(rootHex, undefined, indexPathStr);
      if ("code" in resolved) return resolved;

      if (resolved.node.kind !== "file") {
        return fsError(
          "NOT_A_FILE",
          400,
          "Target is not a file (cannot overwrite directory with indexPath)"
        );
      }
      if (resolved.parentPath.length === 0) {
        return fsError("INVALID_PATH", 400, "Cannot replace root node");
      }

      const newRootHex = await tree.rebuildMerklePath(
        realm,
        ownerId,
        resolved.parentPath,
        fileEncoded.hash
      );

      return {
        newRoot: hexToNodeKey(newRootHex),
        file: {
          path: indexPathStr,
          key: hexToNodeKey(fileHex),
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
      const rootNode = await tree.getAndDecodeNode(rootHex);
      if (!rootNode) return fsError("INVALID_ROOT", 400, "Root node not found");
      if (rootNode.kind !== "dict")
        return fsError("NOT_A_DIRECTORY", 400, "Root is not a directory");

      const existing = findChildByName(rootNode, fileName);
      if (existing) {
        const existingNode = await tree.getAndDecodeNode(hashToHex(existing.hash));
        if (existingNode?.kind === "dict") {
          return fsError(
            "NOT_A_FILE",
            400,
            `'${fileName}' is a directory, cannot overwrite with file`
          );
        }

        const newChildren = [...(rootNode.children ?? [])];
        newChildren[existing.index] = fileEncoded.hash;

        const newRootEncoded = await encodeDictNode(
          { children: newChildren, childNames: rootNode.childNames ?? [] },
          hashProvider
        );
        const newRootHex = await tree.storeNode(
          realm,
          ownerId,
          newRootEncoded.bytes,
          newRootEncoded.hash,
          "dict",
          0
        );

        return {
          newRoot: hexToNodeKey(newRootHex),
          file: {
            path: pathStr,
            key: hexToNodeKey(fileHex),
            size: fileContent.length,
            contentType,
          },
          created: false,
        };
      }

      // Insert new
      const result = await tree.insertChild(
        realm,
        ownerId,
        [],
        rootHex,
        rootNode,
        fileName,
        fileEncoded.hash
      );
      if (typeof result === "object" && "code" in result) return result;

      return {
        newRoot: hexToNodeKey(result),
        file: { path: pathStr, key: hexToNodeKey(fileHex), size: fileContent.length, contentType },
        created: true,
      };
    }

    // Multi-segment: ensure parent dirs
    const parentResult = await tree.ensureParentDirs(realm, ownerId, rootHex, segments);
    if ("code" in parentResult) return parentResult;

    const { parentHash, parentNode, parentPath } = parentResult;
    const existing = findChildByName(parentNode, fileName);
    if (existing) {
      const existingNode = await tree.getAndDecodeNode(hashToHex(existing.hash));
      if (existingNode?.kind === "dict") {
        return fsError(
          "NOT_A_FILE",
          400,
          `'${fileName}' is a directory, cannot overwrite with file`
        );
      }

      const newChildren = [...(parentNode.children ?? [])];
      newChildren[existing.index] = fileEncoded.hash;

      const newParentEncoded = await encodeDictNode(
        { children: newChildren, childNames: parentNode.childNames ?? [] },
        hashProvider
      );
      await tree.storeNode(
        realm,
        ownerId,
        newParentEncoded.bytes,
        newParentEncoded.hash,
        "dict",
        0
      );
      const newRootHex = await tree.rebuildMerklePath(
        realm,
        ownerId,
        parentPath,
        newParentEncoded.hash
      );

      return {
        newRoot: hexToNodeKey(newRootHex),
        file: { path: pathStr, key: hexToNodeKey(fileHex), size: fileContent.length, contentType },
        created: false,
      };
    }

    const result = await tree.insertChild(
      realm,
      ownerId,
      parentPath,
      parentHash,
      parentNode,
      fileName,
      fileEncoded.hash
    );
    if (typeof result === "object" && "code" in result) return result;

    return {
      newRoot: hexToNodeKey(result),
      file: { path: pathStr, key: hexToNodeKey(fileHex), size: fileContent.length, contentType },
      created: true,
    };
  };

  /**
   * mkdir — Create a directory (with implicit parent creation).
   */
  const mkdir = async (
    realm: string,
    ownerId: string,
    rootNodeKey: string,
    pathStr: string
  ): Promise<FsMkdirResponse | FsError> => {
    const rootHex = await tree.resolveNodeKey(realm, rootNodeKey);
    if (typeof rootHex === "object") return rootHex;

    const segments = parsePath(pathStr);
    if ("code" in segments) return segments;
    if (segments.length === 0) {
      return fsError("INVALID_PATH", 400, "Path cannot be empty for mkdir");
    }

    // Check if already exists
    const existing = await tree.resolvePath(rootHex, pathStr);
    if (!("code" in existing)) {
      if (existing.node.kind === "dict") {
        return {
          newRoot: hexToNodeKey(rootHex),
          dir: { path: pathStr, key: hexToNodeKey(existing.hash) },
          created: false,
        };
      }
      return fsError("EXISTS_AS_FILE", 409, `Path '${pathStr}' already exists as a file`);
    }

    const emptyDirEncoded = await encodeDictNode({ children: [], childNames: [] }, hashProvider);
    await tree.storeNode(realm, ownerId, emptyDirEncoded.bytes, emptyDirEncoded.hash, "dict", 0);
    const dirHex = hashToHex(emptyDirEncoded.hash);
    const dirName = segments[segments.length - 1]!;

    if (segments.length === 1) {
      const rootNode = await tree.getAndDecodeNode(rootHex);
      if (!rootNode) return fsError("INVALID_ROOT", 400, "Root node not found");
      if (rootNode.kind !== "dict")
        return fsError("NOT_A_DIRECTORY", 400, "Root is not a directory");

      const result = await tree.insertChild(
        realm,
        ownerId,
        [],
        rootHex,
        rootNode,
        dirName,
        emptyDirEncoded.hash
      );
      if (typeof result === "object" && "code" in result) return result;

      return {
        newRoot: hexToNodeKey(result),
        dir: { path: pathStr, key: hexToNodeKey(dirHex) },
        created: true,
      };
    }

    const parentResult = await tree.ensureParentDirs(realm, ownerId, rootHex, segments);
    if ("code" in parentResult) return parentResult;

    const { parentHash, parentNode, parentPath } = parentResult;
    const result = await tree.insertChild(
      realm,
      ownerId,
      parentPath,
      parentHash,
      parentNode,
      dirName,
      emptyDirEncoded.hash
    );
    if (typeof result === "object" && "code" in result) return result;

    return {
      newRoot: hexToNodeKey(result),
      dir: { path: pathStr, key: hexToNodeKey(dirHex) },
      created: true,
    };
  };

  /**
   * rm — Remove a file or directory.
   */
  const rm = async (
    realm: string,
    ownerId: string,
    rootNodeKey: string,
    pathStr?: string,
    indexPathStr?: string
  ): Promise<FsRmResponse | FsError> => {
    const rootHex = await tree.resolveNodeKey(realm, rootNodeKey);
    if (typeof rootHex === "object") return rootHex;

    if (!pathStr && !indexPathStr) {
      return fsError("CANNOT_REMOVE_ROOT", 400, "Cannot remove root node. Specify a sub-path.");
    }

    const resolved = await tree.resolvePath(rootHex, pathStr, indexPathStr);
    if ("code" in resolved) return resolved;

    if (resolved.parentPath.length === 0) {
      return fsError("CANNOT_REMOVE_ROOT", 400, "Cannot remove root node");
    }

    const lastParent = resolved.parentPath[resolved.parentPath.length - 1]!;
    const newRootHex = await tree.removeChild(
      realm,
      ownerId,
      resolved.parentPath.slice(0, -1),
      lastParent.node,
      lastParent.childIndex
    );

    return {
      newRoot: hexToNodeKey(newRootHex),
      removed: {
        path: pathStr ?? indexPathStr ?? "",
        type: resolved.node.kind === "dict" ? "dir" : "file",
        key: hexToNodeKey(resolved.hash),
      },
    };
  };

  /**
   * mv — Move / rename a file or directory.
   */
  const mv = async (
    realm: string,
    ownerId: string,
    rootNodeKey: string,
    fromPath: string,
    toPath: string
  ): Promise<FsMvResponse | FsError> => {
    const rootHex = await tree.resolveNodeKey(realm, rootNodeKey);
    if (typeof rootHex === "object") return rootHex;

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
        "Cannot move a directory into itself or its subdirectory"
      );
    }

    const source = await tree.resolvePath(rootHex, fromPath);
    if ("code" in source) return source;

    const sourceNodeHash = hexToHash(source.hash);

    if (source.parentPath.length === 0) {
      return fsError("CANNOT_MOVE_ROOT", 400, "Cannot move root node");
    }

    const lastParent = source.parentPath[source.parentPath.length - 1]!;
    const afterRemoveRootHex = await tree.removeChild(
      realm,
      ownerId,
      source.parentPath.slice(0, -1),
      lastParent.node,
      lastParent.childIndex
    );

    const toName = toSegments[toSegments.length - 1]!;

    // Check if target exists in the new tree
    const targetCheck = await tree.resolvePath(afterRemoveRootHex, toPath);
    if (!("code" in targetCheck)) {
      if (targetCheck.node.kind === "dict" && source.node.kind !== "dict") {
        const result = await tree.insertChild(
          realm,
          ownerId,
          targetCheck.parentPath,
          targetCheck.hash,
          targetCheck.node,
          source.name,
          sourceNodeHash
        );
        if (typeof result === "object" && "code" in result) return result;
        return { newRoot: hexToNodeKey(result), from: fromPath, to: `${toPath}/${source.name}` };
      }
      return fsError("TARGET_EXISTS", 409, `Target path already exists: ${toPath}`);
    }

    if (toSegments.length === 1) {
      const rootNode = await tree.getAndDecodeNode(afterRemoveRootHex);
      if (!rootNode) return fsError("INVALID_ROOT", 400, "Root node not found after remove");
      if (rootNode.kind !== "dict")
        return fsError("NOT_A_DIRECTORY", 400, "Root is not a directory");

      const result = await tree.insertChild(
        realm,
        ownerId,
        [],
        afterRemoveRootHex,
        rootNode,
        toName,
        sourceNodeHash
      );
      if (typeof result === "object" && "code" in result) return result;
      return { newRoot: hexToNodeKey(result), from: fromPath, to: toPath };
    }

    const parentResult = await tree.ensureParentDirs(
      realm,
      ownerId,
      afterRemoveRootHex,
      toSegments
    );
    if ("code" in parentResult) return parentResult;

    const result = await tree.insertChild(
      realm,
      ownerId,
      parentResult.parentPath,
      parentResult.parentHash,
      parentResult.parentNode,
      toName,
      sourceNodeHash
    );
    if (typeof result === "object" && "code" in result) return result;

    return { newRoot: hexToNodeKey(result), from: fromPath, to: toPath };
  };

  /**
   * cp — Copy a file or directory (shallow — CAS deduplication handles it).
   */
  const cp = async (
    realm: string,
    ownerId: string,
    rootNodeKey: string,
    fromPath: string,
    toPath: string
  ): Promise<FsCpResponse | FsError> => {
    const rootHex = await tree.resolveNodeKey(realm, rootNodeKey);
    if (typeof rootHex === "object") return rootHex;

    const toSegments = parsePath(toPath);
    if ("code" in toSegments) return toSegments;
    if (toSegments.length === 0) return fsError("INVALID_PATH", 400, "Target path cannot be empty");

    const source = await tree.resolvePath(rootHex, fromPath);
    if ("code" in source) return source;

    const targetCheck = await tree.resolvePath(rootHex, toPath);
    if (!("code" in targetCheck)) {
      return fsError("TARGET_EXISTS", 409, `Target path already exists: ${toPath}`);
    }

    const sourceNodeHash = hexToHash(source.hash);
    const toName = toSegments[toSegments.length - 1]!;

    if (toSegments.length === 1) {
      const rootNode = await tree.getAndDecodeNode(rootHex);
      if (!rootNode) return fsError("INVALID_ROOT", 400, "Root node not found");
      if (rootNode.kind !== "dict")
        return fsError("NOT_A_DIRECTORY", 400, "Root is not a directory");

      const result = await tree.insertChild(
        realm,
        ownerId,
        [],
        rootHex,
        rootNode,
        toName,
        sourceNodeHash
      );
      if (typeof result === "object" && "code" in result) return result;
      return { newRoot: hexToNodeKey(result), from: fromPath, to: toPath };
    }

    const parentResult = await tree.ensureParentDirs(realm, ownerId, rootHex, toSegments);
    if ("code" in parentResult) return parentResult;

    const result = await tree.insertChild(
      realm,
      ownerId,
      parentResult.parentPath,
      parentResult.parentHash,
      parentResult.parentNode,
      toName,
      sourceNodeHash
    );
    if (typeof result === "object" && "code" in result) return result;
    return { newRoot: hexToNodeKey(result), from: fromPath, to: toPath };
  };

  /**
   * rewrite — Declarative batch rewrite (entries + deletes).
   *
   * @param issuerChain - Current AT's issuerChain (for ownership verification)
   * @param issuerId - Current AT's issuerId (DT ID or User ID)
   * @param auth - Full auth context (for scope proof validation)
   */
  const rewrite = async (
    realm: string,
    ownerId: string,
    rootNodeKey: string,
    entries?: Record<string, FsRewriteEntry>,
    deletes?: string[],
    issuerChain?: string[],
    issuerId?: string,
    auth?: AccessTokenAuthContext
  ): Promise<FsRewriteResponse | FsError> => {
    const rootHex = await tree.resolveNodeKey(realm, rootNodeKey);
    if (typeof rootHex === "object") return rootHex;

    const entryCount = entries ? Object.keys(entries).length : 0;
    const deleteCount = deletes?.length ?? 0;

    if (entryCount === 0 && deleteCount === 0) {
      return fsError("EMPTY_REWRITE", 400, "entries and deletes cannot both be empty");
    }
    if (entryCount + deleteCount > FS_MAX_REWRITE_ENTRIES) {
      return fsError(
        "TOO_MANY_ENTRIES",
        400,
        `Total entries + deletes exceeds ${FS_MAX_REWRITE_ENTRIES}`
      );
    }

    let currentRootHex = rootHex;
    const originalRootHex = rootHex;

    // Phase 1: deletes
    let actualDeleted = 0;
    if (deletes && deletes.length > 0) {
      for (const deletePath of deletes) {
        const pathSegments = parsePath(deletePath);
        if ("code" in pathSegments) return pathSegments;

        const resolved = await tree.resolvePath(currentRootHex, deletePath);
        if ("code" in resolved) continue; // skip non-existent

        if (resolved.parentPath.length === 0) {
          return fsError("CANNOT_REMOVE_ROOT", 400, "Cannot delete root path");
        }

        const lastParent = resolved.parentPath[resolved.parentPath.length - 1]!;
        currentRootHex = await tree.removeChild(
          realm,
          ownerId,
          resolved.parentPath.slice(0, -1),
          lastParent.node,
          lastParent.childIndex
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
          const source = await tree.resolvePath(originalRootHex, entry.from);
          if ("code" in source) {
            return fsError(
              "PATH_NOT_FOUND",
              404,
              `Entry '${targetPath}' references non-existent source path`,
              {
                entry: targetPath,
                from: entry.from,
              }
            );
          }
          nodeHash = hexToHash(source.hash);
        } else if ("dir" in entry) {
          const emptyEncoded = await encodeDictNode({ children: [], childNames: [] }, hashProvider);
          await tree.storeNode(realm, ownerId, emptyEncoded.bytes, emptyEncoded.hash, "dict", 0);
          nodeHash = emptyEncoded.hash;
        } else if ("link" in entry) {
          const linkKey = entry.link;
          if (!linkKey.startsWith("nod_")) {
            return fsError("INVALID_PATH", 400, `Invalid link key format: ${linkKey}`);
          }
          const linkHex = nodeKeyToHex(linkKey);

          const exists = await storage.has(linkHex);
          if (!exists) {
            return fsError("NODE_NOT_FOUND", 404, `Linked node not found: ${linkKey}`);
          }

          // Step 1: ownership verification using delegate chain
          let authorized = false;
          if (issuerChain && issuerChain.length > 0) {
            for (const id of issuerChain) {
              if (await ownershipV2Db.hasOwnership(linkHex, id)) {
                authorized = true;
                break;
              }
            }
          }

          // Step 2: scope verification (proof) — only if uploader verification failed
          if (!authorized && entry.proof) {
            if (auth) {
              const scopeProofDeps: ScopeProofDeps = {
                storage: deps.storage,
                scopeSetNodesDb: deps.scopeSetNodesDb,
              };
              authorized = await validateProofAgainstScope(
                entry.proof,
                linkHex,
                auth,
                scopeProofDeps
              );
            }
          }

          if (!authorized) {
            return fsError(
              "LINK_NOT_AUTHORIZED",
              403,
              `Not authorized to reference node: ${linkKey}. Upload the node first or provide a valid proof (index-path).`
            );
          }

          nodeHash = hexToHash(linkHex);
        } else {
          return fsError("INVALID_PATH", 400, `Invalid entry type for '${targetPath}'`);
        }

        // Insert / replace at target path
        const targetName = targetSegments[targetSegments.length - 1]!;

        if (targetSegments.length === 1) {
          const rootNode = await tree.getAndDecodeNode(currentRootHex);
          if (!rootNode) return fsError("INVALID_ROOT", 400, "Root node not found");
          if (rootNode.kind !== "dict")
            return fsError("NOT_A_DIRECTORY", 400, "Root is not a directory");

          const existingChild = findChildByName(rootNode, targetName);
          if (existingChild) {
            const newChildren = [...(rootNode.children ?? [])];
            newChildren[existingChild.index] = nodeHash;
            const encoded = await encodeDictNode(
              { children: newChildren, childNames: rootNode.childNames ?? [] },
              hashProvider
            );
            currentRootHex = await tree.storeNode(
              realm,
              ownerId,
              encoded.bytes,
              encoded.hash,
              "dict",
              0
            );
          } else {
            const result = await tree.insertChild(
              realm,
              ownerId,
              [],
              currentRootHex,
              rootNode,
              targetName,
              nodeHash
            );
            if (typeof result === "object" && "code" in result) return result;
            currentRootHex = result;
          }
        } else {
          const parentResult = await tree.ensureParentDirs(
            realm,
            ownerId,
            currentRootHex,
            targetSegments
          );
          if ("code" in parentResult) return parentResult;

          const { parentHash, parentNode, parentPath } = parentResult;
          const existingChild = findChildByName(parentNode, targetName);
          if (existingChild) {
            const newChildren = [...(parentNode.children ?? [])];
            newChildren[existingChild.index] = nodeHash;
            const encoded = await encodeDictNode(
              { children: newChildren, childNames: parentNode.childNames ?? [] },
              hashProvider
            );
            await tree.storeNode(realm, ownerId, encoded.bytes, encoded.hash, "dict", 0);
            currentRootHex = await tree.rebuildMerklePath(realm, ownerId, parentPath, encoded.hash);
          } else {
            const result = await tree.insertChild(
              realm,
              ownerId,
              parentPath,
              parentHash,
              parentNode,
              targetName,
              nodeHash
            );
            if (typeof result === "object" && "code" in result) return result;
            currentRootHex = result;
          }
        }

        actualApplied++;
      }
    }

    return {
      newRoot: hexToNodeKey(currentRootHex),
      entriesApplied: actualApplied,
      deleted: actualDeleted,
    };
  };

  return { write, mkdir, rm, mv, cp, rewrite };
};
