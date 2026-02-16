/**
 * Pull Remote Tree — fetch server-side changed nodes into local storage.
 *
 * Before a 3-way merge, the client must ensure all nodes from the server's
 * tree are available locally. This module does a recursive walk comparing
 * the base tree (already local) against the remote tree, fetching only
 * nodes that differ (hash short-circuit).
 *
 * Authorization: remote nodes are fetched via a navigated-path callback
 * that uses the depot root key as the authorization anchor. The server's
 * `getNavigated` API only auth-checks the starting key and walks children
 * without individual auth checks.
 *
 * @packageDocumentation
 */

import {
  type CasNode,
  type StorageProvider,
  decodeNode,
  getWellKnownNodeData,
  hashToKey,
  isWellKnownNode,
} from "@casfa/core";
import type { PullOptions, PullResult } from "./types.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Try to read a node from local storage, falling back to well-known data.
 * Returns null if not available locally.
 */
function tryGetLocal(
  storage: StorageProvider,
  storageKey: string,
): Promise<Uint8Array | null> | Uint8Array | null {
  if (isWellKnownNode(storageKey)) {
    return getWellKnownNodeData(storageKey) ?? null;
  }
  return storage.get(storageKey);
}

// ---------------------------------------------------------------------------
// Core pull
// ---------------------------------------------------------------------------

/**
 * Recursively pull remote tree changes into local storage.
 *
 * Walks the remote tree from `remoteRootKey`, comparing against `baseRootKey`.
 * Uses hash short-circuit: when a subtree hash matches, it is skipped entirely.
 *
 * For each remote node not found locally, calls `options.fetchNode(navPath)`
 * which should resolve to `client.nodes.getNavigated(remoteRootKey, navPath)`
 * (or direct `client.nodes.get()` for the root when navPath is `""`).
 *
 * @param baseRootKey  - Storage key (CB32 hash) of the base (common ancestor) root.
 * @param remoteRootKey - Storage key (CB32 hash) of the remote (server) root.
 * @param options - Storage and fetch callback.
 * @returns Pull statistics.
 */
export async function pullRemoteTree(
  baseRootKey: string,
  remoteRootKey: string,
  options: PullOptions,
): Promise<PullResult> {
  const { storage, fetchNode } = options;

  // Fast path: identical roots
  if (baseRootKey === remoteRootKey) {
    return { nodesFetched: 0, nodesSkipped: 0 };
  }

  let nodesFetched = 0;
  let nodesSkipped = 0;

  /**
   * Recursively walk, comparing base vs remote subtrees.
   *
   * @param baseKey    - storage key of the base node (or null if absent)
   * @param remoteKey  - storage key of the remote node
   * @param navPath    - navigation index path from remote root (e.g. "~0/~2")
   */
  async function walk(
    baseKey: string | null,
    remoteKey: string,
    navPath: string,
  ): Promise<void> {
    // Hash short-circuit: if base hash equals remote hash, all children are identical
    if (baseKey === remoteKey) {
      nodesSkipped++;
      return;
    }

    // Try to get the remote node from local storage
    let remoteData = await tryGetLocal(storage, remoteKey);

    if (!remoteData) {
      // Not local — fetch from server via navigated path
      const fetched = await fetchNode(navPath);
      if (!fetched) {
        // Node not reachable from remote root; skip gracefully
        return;
      }
      remoteData = fetched;

      // Store in local storage for subsequent merge operations
      await storage.put(remoteKey, remoteData);
      nodesFetched++;
    } else {
      nodesSkipped++;
    }

    // Decode to check if it's a d-node with children
    let remoteNode: CasNode;
    try {
      remoteNode = decodeNode(remoteData);
    } catch {
      // Can't decode — treat as leaf
      return;
    }

    if (remoteNode.kind !== "dict") {
      // f-node / successor — leaf, nothing to recurse into
      return;
    }

    // Get base node for comparison (should be locally available)
    let baseNode: CasNode | null = null;
    if (baseKey) {
      const baseData = await tryGetLocal(storage, baseKey);
      if (baseData) {
        try {
          baseNode = decodeNode(baseData);
        } catch {
          baseNode = null;
        }
      }
    }

    // Build a map of base children by name for O(1) lookup
    const baseChildMap = new Map<string, string>(); // name → storageKey
    if (baseNode?.kind === "dict" && baseNode.childNames && baseNode.children) {
      for (let i = 0; i < baseNode.childNames.length; i++) {
        const name = baseNode.childNames[i]!;
        const hash = baseNode.children[i]!;
        baseChildMap.set(name, hashToKey(hash));
      }
    }

    // Recurse into each remote child
    const remoteNames = remoteNode.childNames ?? [];
    const remoteChildren = remoteNode.children ?? [];

    for (let i = 0; i < remoteNames.length; i++) {
      const childHash = remoteChildren[i]!;
      const childStorageKey = hashToKey(childHash);
      const childName = remoteNames[i]!;

      // Find corresponding base child
      const baseChildKey = baseChildMap.get(childName) ?? null;

      // Build child nav path  (e.g. "" → "~0", "~0" → "~0/~1")
      const childNavPath = navPath ? `${navPath}/~${i}` : `~${i}`;

      await walk(baseChildKey, childStorageKey, childNavPath);
    }
  }

  // Start walk from roots
  await walk(baseRootKey, remoteRootKey, "");

  return { nodesFetched, nodesSkipped };
}
