/**
 * Filesystem Service — Tree Operations
 *
 * Low-level CAS tree operations: node resolution, path traversal,
 * Merkle path rebuild, child insertion / removal, and parent-dir creation.
 */

import { type CasNode, decodeNode, encodeDictNode } from "@casfa/core";
import { FS_MAX_COLLECTION_CHILDREN, FS_MAX_NAME_BYTES, nodeKeyToHex } from "@casfa/protocol";

import {
  findChildByIndex,
  findChildByName,
  hashToHex,
  parseIndexPath,
  parsePath,
} from "./helpers.ts";
import { type FsError, type FsServiceDeps, fsError, type ResolvedNode } from "./types.ts";

const textEncoder = new TextEncoder();

// ============================================================================
// Tree Operations Factory
// ============================================================================

export type TreeOps = ReturnType<typeof createTreeOps>;

export const createTreeOps = (deps: FsServiceDeps) => {
  const { storage, hashProvider, ownershipV2Db, refCountDb, usageDb, depotsDb } = deps;

  // --------------------------------------------------------------------------
  // Node I/O
  // --------------------------------------------------------------------------

  /** Get raw node bytes from storage by hex key */
  const getNodeData = async (hexKey: string): Promise<Uint8Array | null> => {
    return storage.get(hexKey);
  };

  /** Decode a CAS node from storage by hex key */
  const getAndDecodeNode = async (hexKey: string): Promise<CasNode | null> => {
    const data = await getNodeData(hexKey);
    if (!data) return null;
    try {
      return decodeNode(data);
    } catch {
      return null;
    }
  };

  /**
   * Store a new node, update ownership / refcount / usage.
   * Returns the hex key of the stored node.
   *
   * @param ownerId - The delegate ID for ownership tracking
   */
  const storeNode = async (
    realm: string,
    ownerId: string,
    bytes: Uint8Array,
    hash: Uint8Array,
    kind: "dict" | "file",
    logicalSize: number
  ): Promise<string> => {
    const hexKey = hashToHex(hash);

    const exists = await storage.has(hexKey);
    if (!exists) {
      await storage.put(hexKey, bytes);
      // Write ownership for the current delegate (single-record).
      // Full-chain writes for user content happen in chunks.ts PUT handler.
      await ownershipV2Db.addOwnership(
        hexKey,
        [ownerId],
        ownerId,
        "application/octet-stream",
        logicalSize,
        kind
      );
      const { isNewToRealm } = await refCountDb.incrementRef(
        realm,
        hexKey,
        bytes.length,
        logicalSize
      );
      if (isNewToRealm) {
        await usageDb.updateUsage(realm, {
          physicalBytes: bytes.length,
          logicalBytes: logicalSize,
          nodeCount: 1,
        });
      }
    } else {
      await refCountDb.incrementRef(realm, hexKey, bytes.length, logicalSize);
    }

    return hexKey;
  };

  // --------------------------------------------------------------------------
  // Node Key Resolution
  // --------------------------------------------------------------------------

  /**
   * Resolve a user-facing nodeKey (nod_xxx / dpt_xxx) to a hex storage key.
   */
  const resolveNodeKey = async (realm: string, nodeKey: string): Promise<string | FsError> => {
    if (nodeKey.startsWith("nod_")) {
      return nodeKeyToHex(nodeKey);
    }
    if (nodeKey.startsWith("dpt_")) {
      const depot = await depotsDb.get(realm, nodeKey);
      if (!depot) {
        return fsError("INVALID_ROOT", 400, `Depot not found: ${nodeKey}`);
      }
      return nodeKeyToHex(depot.root);
    }
    return fsError("INVALID_ROOT", 400, `Invalid nodeKey format: ${nodeKey}`);
  };

  // --------------------------------------------------------------------------
  // Path Resolution
  // --------------------------------------------------------------------------

  /**
   * Resolve path + indexPath to a target node, collecting the parent chain.
   */
  const resolvePath = async (
    rootHex: string,
    pathStr?: string,
    indexPathStr?: string
  ): Promise<ResolvedNode | FsError> => {
    const rootNode = await getAndDecodeNode(rootHex);
    if (!rootNode) {
      return fsError("INVALID_ROOT", 400, "Root node not found or invalid");
    }

    if (!pathStr && !indexPathStr) {
      return { hash: rootHex, node: rootNode, name: "", parentPath: [] };
    }

    // Parse segments
    let pathSegments: string[] = [];
    if (pathStr) {
      const parsed = parsePath(pathStr);
      if ("code" in parsed) return parsed;
      pathSegments = parsed;
    }

    let indexIndices: number[] = [];
    if (indexPathStr) {
      const parsed = parseIndexPath(indexPathStr);
      if ("code" in parsed) return parsed;
      indexIndices = parsed;
    }

    let currentHash = rootHex;
    let currentNode = rootNode;
    let currentName = "";
    const parentPath: ResolvedNode["parentPath"] = [];

    // Navigate by name
    for (const segment of pathSegments) {
      if (currentNode.kind !== "dict") {
        return fsError("NOT_A_DIRECTORY", 400, `'${currentName}' is not a directory`, {
          path: currentName,
        });
      }

      const child = findChildByName(currentNode, segment);
      if (!child) {
        return fsError("PATH_NOT_FOUND", 404, `Path not found: '${segment}'`, {
          resolvedTo: currentName,
          missingSegment: segment,
        });
      }

      const childHex = hashToHex(child.hash);
      const childNode = await getAndDecodeNode(childHex);
      if (!childNode) {
        return fsError("PATH_NOT_FOUND", 404, `Node data not found for '${segment}'`);
      }

      parentPath.push({ hash: currentHash, node: currentNode, childIndex: child.index });
      currentHash = childHex;
      currentNode = childNode;
      currentName = segment;
    }

    // Continue by index
    for (const index of indexIndices) {
      if (currentNode.kind !== "dict") {
        return fsError("NOT_A_DIRECTORY", 400, "Node at index is not a directory");
      }

      const child = findChildByIndex(currentNode, index);
      if (!child) {
        return fsError("INDEX_OUT_OF_BOUNDS", 400, `Index ${index} out of bounds`, {
          maxIndex: (currentNode.children?.length ?? 0) - 1,
        });
      }

      const childHex = hashToHex(child.hash);
      const childNode = await getAndDecodeNode(childHex);
      if (!childNode) {
        return fsError("PATH_NOT_FOUND", 404, `Node data not found at index ${index}`);
      }

      parentPath.push({ hash: currentHash, node: currentNode, childIndex: index });
      currentHash = childHex;
      currentNode = childNode;
      currentName = child.name;
    }

    return { hash: currentHash, node: currentNode, name: currentName, parentPath };
  };

  // --------------------------------------------------------------------------
  // Merkle Rebuild
  // --------------------------------------------------------------------------

  /**
   * Rebuild the Merkle path from a changed child up to the root.
   * `parentPath` must NOT include the node whose hash changed (only its ancestors).
   * Returns the new root hex key.
   */
  const rebuildMerklePath = async (
    realm: string,
    ownerId: string,
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
        hashProvider
      );

      await storeNode(realm, ownerId, encoded.bytes, encoded.hash, "dict", 0);
      currentChildHash = encoded.hash;
    }

    return hashToHex(currentChildHash);
  };

  // --------------------------------------------------------------------------
  // Child Mutation
  // --------------------------------------------------------------------------

  /**
   * Insert a new child into a d-node, rebuild Merkle path, return new root hex.
   * `parentPath` must NOT include the parent node being modified.
   */
  const insertChild = async (
    realm: string,
    ownerId: string,
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
      hashProvider
    );

    await storeNode(realm, ownerId, encoded.bytes, encoded.hash, "dict", 0);
    return rebuildMerklePath(realm, ownerId, parentPath, encoded.hash);
  };

  /**
   * Remove a child from a d-node by index, rebuild Merkle path, return new root hex.
   * `parentPath` must NOT include the parent node being modified.
   */
  const removeChild = async (
    realm: string,
    ownerId: string,
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
      hashProvider
    );

    await storeNode(realm, ownerId, encoded.bytes, encoded.hash, "dict", 0);
    return rebuildMerklePath(realm, ownerId, parentPath, encoded.hash);
  };

  // --------------------------------------------------------------------------
  // Directory Creation
  // --------------------------------------------------------------------------

  /**
   * Ensure all intermediate directories exist along `segments` (excluding the
   * last segment, which is the target).  Returns the parent node info and the
   * parentPath from root → parent.
   */
  const ensureParentDirs = async (
    realm: string,
    ownerId: string,
    rootHex: string,
    segments: string[]
  ): Promise<
    { parentHash: string; parentNode: CasNode; parentPath: ResolvedNode["parentPath"] } | FsError
  > => {
    let currentHash = rootHex;
    let currentNode = await getAndDecodeNode(rootHex);
    if (!currentNode) {
      return fsError("INVALID_ROOT", 400, "Root node not found");
    }

    const builtParentPath: ResolvedNode["parentPath"] = [];

    for (let i = 0; i < segments.length - 1; i++) {
      const seg = segments[i]!;

      if (currentNode.kind !== "dict") {
        return fsError("NOT_A_DIRECTORY", 400, `'${seg}' is not a directory`);
      }

      const child = findChildByName(currentNode, seg);
      if (child) {
        const childHex = hashToHex(child.hash);
        const childNode = await getAndDecodeNode(childHex);
        if (!childNode) {
          return fsError("PATH_NOT_FOUND", 404, `Node data not found for '${seg}'`);
        }
        if (childNode.kind !== "dict") {
          return fsError("NOT_A_DIRECTORY", 400, `'${seg}' exists but is not a directory`);
        }
        builtParentPath.push({ hash: currentHash, node: currentNode, childIndex: child.index });
        currentHash = childHex;
        currentNode = childNode;
      } else {
        // Create all remaining intermediate dirs bottom-up
        let newDirHash: Uint8Array | null = null;

        for (let j = segments.length - 2; j > i; j--) {
          const emptyEncoded = await encodeDictNode(
            {
              children: newDirHash ? [newDirHash] : [],
              childNames: newDirHash ? [segments[j + 1]!] : [],
            },
            hashProvider
          );
          await storeNode(realm, ownerId, emptyEncoded.bytes, emptyEncoded.hash, "dict", 0);
          newDirHash = emptyEncoded.hash;
        }

        if (!newDirHash) {
          const emptyEncoded = await encodeDictNode({ children: [], childNames: [] }, hashProvider);
          await storeNode(realm, ownerId, emptyEncoded.bytes, emptyEncoded.hash, "dict", 0);
          newDirHash = emptyEncoded.hash;
        }

        const newNames = [...(currentNode.childNames ?? []), seg];
        const newChildren = [...(currentNode.children ?? []), newDirHash];
        const parentEncoded = await encodeDictNode(
          { children: newChildren, childNames: newNames },
          hashProvider
        );
        await storeNode(realm, ownerId, parentEncoded.bytes, parentEncoded.hash, "dict", 0);

        const newRootHex = await rebuildMerklePath(
          realm,
          ownerId,
          builtParentPath,
          parentEncoded.hash
        );
        // Re-resolve from the new root
        return ensureParentDirs(realm, ownerId, newRootHex, segments);
      }
    }

    return { parentHash: currentHash, parentNode: currentNode, parentPath: builtParentPath };
  };

  return {
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
