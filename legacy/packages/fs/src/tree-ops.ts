/**
 * @casfa/fs — Tree Operations
 *
 * Low-level CAS tree operations: node resolution, path traversal,
 * Merkle path rebuild, child insertion / removal, and parent-dir creation.
 *
 * All operations depend only on FsContext (StorageProvider + KeyProvider)
 * plus optional hooks. No database or server dependencies.
 */

import type { PathSegment } from "@casfa/cas-uri";
import { type CasNode, decodeNode, encodeDictNode, getWellKnownNodeData } from "@casfa/core";
import {
  FS_MAX_COLLECTION_CHILDREN,
  FS_MAX_NAME_BYTES,
  nodeKeyToStorageKey,
} from "@casfa/protocol";
import { findChildByIndex, findChildByName, hashToStorageKey } from "./helpers.ts";
import { type FsContext, type FsError, fsError, type ResolvedNode } from "./types.ts";

const textEncoder = new TextEncoder();

// ============================================================================
// Tree Operations Factory
// ============================================================================

export type TreeOps = ReturnType<typeof createTreeOps>;

export const createTreeOps = (ctx: FsContext) => {
  const { storage, key: keyProvider, onNodeStored } = ctx;

  // --------------------------------------------------------------------------
  // Node I/O
  // --------------------------------------------------------------------------

  /** Get raw node bytes from storage by CB32 key */
  const getNodeData = async (storageKey: string): Promise<Uint8Array | null> => {
    // Well-known nodes — return in-memory bytes, skip storage
    const wellKnown = getWellKnownNodeData(storageKey);
    if (wellKnown) return wellKnown;
    return storage.get(storageKey);
  };

  /** Decode a CAS node from storage by CB32 key */
  const getAndDecodeNode = async (storageKey: string): Promise<CasNode | null> => {
    const data = await getNodeData(storageKey);
    if (!data) return null;
    try {
      return decodeNode(data);
    } catch {
      return null;
    }
  };

  /**
   * Store a node in storage and invoke the onNodeStored hook.
   * Returns the CB32 storage key.
   *
   * Always calls storage.put() unconditionally — CAS put is idempotent and
   * each storage implementation handles dedup internally (e.g. HttpStorage
   * runs check → upload/claim/no-op).
   */
  const storeNode = async (
    bytes: Uint8Array,
    nodeHash: Uint8Array,
    kind: "dict" | "file",
    logicalSize: number
  ): Promise<string> => {
    const storageKey = hashToStorageKey(nodeHash);

    await storage.put(storageKey, bytes);

    if (onNodeStored) {
      await onNodeStored({ storageKey, bytes, hash: nodeHash, kind, logicalSize });
    }

    return storageKey;
  };

  // --------------------------------------------------------------------------
  // Node Key Resolution
  // --------------------------------------------------------------------------

  /**
   * Resolve a user-facing nodeKey (nod_xxx / dpt_xxx) to a CB32 storage key.
   */
  const resolveNodeKey = async (nodeKey: string): Promise<string | FsError> => {
    if (nodeKey.startsWith("nod_")) {
      return nodeKeyToStorageKey(nodeKey);
    }

    // Custom resolver (server can handle dpt_ keys etc.)
    if (ctx.resolveNodeKey) {
      return ctx.resolveNodeKey(nodeKey);
    }

    return fsError("INVALID_ROOT", 400, `Invalid nodeKey format: ${nodeKey}`);
  };

  // --------------------------------------------------------------------------
  // Path Resolution
  // --------------------------------------------------------------------------

  /**
   * Resolve a sequence of PathSegments to a target node, collecting the
   * parent chain for Merkle-path rebuilds.
   *
   * Segments are traversed in order — name and index segments may be
   * freely interleaved (e.g. `["src", ~2, "utils", ~0]`).
   */
  const resolvePath = async (
    rootStorageKey: string,
    segments: PathSegment[] = []
  ): Promise<ResolvedNode | FsError> => {
    const rootNode = await getAndDecodeNode(rootStorageKey);
    if (!rootNode) {
      return fsError("INVALID_ROOT", 400, "Root node not found or invalid");
    }

    if (segments.length === 0) {
      return { hash: rootStorageKey, node: rootNode, name: "", parentPath: [] };
    }

    let currentHash = rootStorageKey;
    let currentNode = rootNode;
    let currentName = "";
    const parentPath: ResolvedNode["parentPath"] = [];

    for (const segment of segments) {
      if (currentNode.kind !== "dict") {
        const label = segment.kind === "name" ? `'${segment.value}'` : `~${segment.value}`;
        return fsError(
          "NOT_A_DIRECTORY",
          400,
          `Cannot descend into '${currentName}' (not a directory) at segment ${label}`,
          {
            path: currentName,
          }
        );
      }

      if (segment.kind === "name") {
        const child = findChildByName(currentNode, segment.value);
        if (!child) {
          return fsError("PATH_NOT_FOUND", 404, `Path not found: '${segment.value}'`, {
            resolvedTo: currentName,
            missingSegment: segment.value,
          });
        }

        const childStorageKey = hashToStorageKey(child.hash);
        const childNode = await getAndDecodeNode(childStorageKey);
        if (!childNode) {
          return fsError("PATH_NOT_FOUND", 404, `Node data not found for '${segment.value}'`);
        }

        parentPath.push({ hash: currentHash, node: currentNode, childIndex: child.index });
        currentHash = childStorageKey;
        currentNode = childNode;
        currentName = segment.value;
      } else {
        // index segment
        const child = findChildByIndex(currentNode, segment.value);
        if (!child) {
          return fsError("INDEX_OUT_OF_BOUNDS", 400, `Index ${segment.value} out of bounds`, {
            maxIndex: (currentNode.children?.length ?? 0) - 1,
          });
        }

        const childStorageKey = hashToStorageKey(child.hash);
        const childNode = await getAndDecodeNode(childStorageKey);
        if (!childNode) {
          return fsError("PATH_NOT_FOUND", 404, `Node data not found at index ${segment.value}`);
        }

        parentPath.push({ hash: currentHash, node: currentNode, childIndex: segment.value });
        currentHash = childStorageKey;
        currentNode = childNode;
        currentName = child.name;
      }
    }

    return { hash: currentHash, node: currentNode, name: currentName, parentPath };
  };

  // --------------------------------------------------------------------------
  // Merkle Rebuild
  // --------------------------------------------------------------------------

  /**
   * Rebuild the Merkle path from a changed child up to the root.
   * `parentPath` must NOT include the node whose hash changed (only its ancestors).
   * Returns the new root CB32 storage key.
   */
  const rebuildMerklePath = async (
    parentPath: ResolvedNode["parentPath"],
    newChildHash: Uint8Array
  ): Promise<string> => {
    let currentChildHash = newChildHash;

    for (let i = parentPath.length - 1; i >= 0; i--) {
      const parent = parentPath[i]!;
      const newChildren = [...(parent.node.children ?? [])];
      newChildren[parent.childIndex] = currentChildHash;

      const encoded = await encodeDictNode(
        { children: newChildren, childNames: parent.node.childNames ?? [] },
        keyProvider
      );

      await storeNode(encoded.bytes, encoded.hash, "dict", 0);
      currentChildHash = encoded.hash;
    }

    return hashToStorageKey(currentChildHash);
  };

  // --------------------------------------------------------------------------
  // Child Mutation
  // --------------------------------------------------------------------------

  /**
   * Insert a new child into a d-node, rebuild Merkle path, return new root CB32 key.
   */
  const insertChild = async (
    parentPath: ResolvedNode["parentPath"],
    _parentHash: string,
    parentNode: CasNode,
    childName: string,
    childHash: Uint8Array
  ): Promise<string | FsError> => {
    const existingNames = parentNode.childNames ?? [];
    const existingChildren = parentNode.children ?? [];

    if (existingNames.length >= FS_MAX_COLLECTION_CHILDREN) {
      return fsError("COLLECTION_FULL", 400, "Directory child count limit reached");
    }

    const nameBytes = textEncoder.encode(childName);
    if (nameBytes.length > FS_MAX_NAME_BYTES) {
      return fsError("NAME_TOO_LONG", 400, `Name too long: ${nameBytes.length} bytes`);
    }

    const newNames = [...existingNames, childName];
    const newChildren = [...existingChildren, childHash];

    const encoded = await encodeDictNode(
      { children: newChildren, childNames: newNames },
      keyProvider
    );

    await storeNode(encoded.bytes, encoded.hash, "dict", 0);
    return rebuildMerklePath(parentPath, encoded.hash);
  };

  /**
   * Remove a child from a d-node by index, rebuild Merkle path, return new root CB32 key.
   */
  const removeChild = async (
    parentPath: ResolvedNode["parentPath"],
    parentNode: CasNode,
    childIndex: number
  ): Promise<string> => {
    const existingNames = [...(parentNode.childNames ?? [])];
    const existingChildren = [...(parentNode.children ?? [])];

    existingNames.splice(childIndex, 1);
    existingChildren.splice(childIndex, 1);

    const encoded = await encodeDictNode(
      { children: existingChildren, childNames: existingNames },
      keyProvider
    );

    await storeNode(encoded.bytes, encoded.hash, "dict", 0);
    return rebuildMerklePath(parentPath, encoded.hash);
  };

  // --------------------------------------------------------------------------
  // Directory Creation
  // --------------------------------------------------------------------------

  /**
   * Ensure all intermediate directories exist along `segments` (excluding the
   * last segment, which is the target). Returns the parent node info.
   *
   * Name segments are created if missing (mkdir -p). Index segments must
   * already exist (you cannot "create" a child by index).
   */
  const ensureParentDirs = async (
    rootStorageKey: string,
    segments: PathSegment[]
  ): Promise<
    { parentHash: string; parentNode: CasNode; parentPath: ResolvedNode["parentPath"] } | FsError
  > => {
    let currentHash = rootStorageKey;
    let currentNode = await getAndDecodeNode(rootStorageKey);
    if (!currentNode) {
      return fsError("INVALID_ROOT", 400, "Root node not found");
    }

    const builtParentPath: ResolvedNode["parentPath"] = [];

    for (let i = 0; i < segments.length - 1; i++) {
      const seg = segments[i]!;

      if (currentNode.kind !== "dict") {
        return fsError("NOT_A_DIRECTORY", 400, "Path component is not a directory");
      }

      if (seg.kind === "index") {
        // Index segment — must exist, navigate through
        const child = findChildByIndex(currentNode, seg.value);
        if (!child) {
          return fsError("INDEX_OUT_OF_BOUNDS", 400, `Index ${seg.value} out of bounds`, {
            maxIndex: (currentNode.children?.length ?? 0) - 1,
          });
        }
        const childKey = hashToStorageKey(child.hash);
        const childNode = await getAndDecodeNode(childKey);
        if (!childNode) {
          return fsError("PATH_NOT_FOUND", 404, `Node data not found at index ${seg.value}`);
        }
        if (childNode.kind !== "dict") {
          return fsError("NOT_A_DIRECTORY", 400, `Node at index ${seg.value} is not a directory`);
        }
        builtParentPath.push({ hash: currentHash, node: currentNode, childIndex: seg.value });
        currentHash = childKey;
        currentNode = childNode;
        continue;
      }

      // Name segment — navigate or create
      const child = findChildByName(currentNode, seg.value);
      if (child) {
        const childStorageKey = hashToStorageKey(child.hash);
        const childNode = await getAndDecodeNode(childStorageKey);
        if (!childNode) {
          return fsError("PATH_NOT_FOUND", 404, `Node data not found for '${seg.value}'`);
        }
        if (childNode.kind !== "dict") {
          return fsError("NOT_A_DIRECTORY", 400, `'${seg.value}' exists but is not a directory`);
        }
        builtParentPath.push({ hash: currentHash, node: currentNode, childIndex: child.index });
        currentHash = childStorageKey;
        currentNode = childNode;
      } else {
        // Create missing directory.
        // Optimisation: batch-create consecutive remaining name-only segments.
        const remaining = segments.slice(i + 1, -1); // intermediates after this
        const allRemainingNames = remaining.every((s) => s.kind === "name");

        if (allRemainingNames) {
          // Batch bottom-up creation (original optimisation)
          let newDirHash: Uint8Array | null = null;

          for (let j = segments.length - 2; j > i; j--) {
            const nextSeg = segments[j + 1]!;
            const nextName = nextSeg.kind === "name" ? nextSeg.value : `~${nextSeg.value}`;
            const emptyEncoded = await encodeDictNode(
              {
                children: newDirHash ? [newDirHash] : [],
                childNames: newDirHash ? [nextName] : [],
              },
              keyProvider
            );
            await storeNode(emptyEncoded.bytes, emptyEncoded.hash, "dict", 0);
            newDirHash = emptyEncoded.hash;
          }

          if (!newDirHash) {
            const emptyEncoded = await encodeDictNode(
              { children: [], childNames: [] },
              keyProvider
            );
            await storeNode(emptyEncoded.bytes, emptyEncoded.hash, "dict", 0);
            newDirHash = emptyEncoded.hash;
          }

          const newNames = [...(currentNode.childNames ?? []), seg.value];
          const newChildren = [...(currentNode.children ?? []), newDirHash];
          const parentEncoded = await encodeDictNode(
            { children: newChildren, childNames: newNames },
            keyProvider
          );
          await storeNode(parentEncoded.bytes, parentEncoded.hash, "dict", 0);

          const newRootKey = await rebuildMerklePath(builtParentPath, parentEncoded.hash);
          // Re-resolve from the new root
          return ensureParentDirs(newRootKey, segments);
        }

        // Mixed segments remain — create single dir, rebuild, re-resolve
        const emptyEncoded = await encodeDictNode({ children: [], childNames: [] }, keyProvider);
        await storeNode(emptyEncoded.bytes, emptyEncoded.hash, "dict", 0);

        const result = await insertChild(
          builtParentPath,
          currentHash,
          currentNode,
          seg.value,
          emptyEncoded.hash
        );
        if (typeof result === "object" && "code" in result) return result;

        return ensureParentDirs(result, segments);
      }
    }

    return { parentHash: currentHash, parentNode: currentNode, parentPath: builtParentPath };
  };

  return {
    getNodeData,
    getAndDecodeNode,
    storeNode,
    resolveNodeKey,
    resolvePath,
    rebuildMerklePath,
    insertChild,
    removeChild,
    ensureParentDirs,
  };
};
