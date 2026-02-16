/**
 * Merge Handler Factory
 *
 * Creates a `MergeHandler` callback that composes:
 *   1. `pullRemoteTree` — fetch server-side changed nodes into local storage
 *   2. `dagMerge` — 3-way merge with LWW conflict resolution
 *   3. `applyMergeOps` — apply merge operations to produce a new root
 *
 * The handler is designed to be passed to `createSyncManager` as the
 * `mergeHandler` option, enabling automatic 3-way merge on commit conflicts.
 *
 * @packageDocumentation
 */

import type { CasfaClient } from "@casfa/client";
import type { KeyProvider, StorageProvider } from "@casfa/core";
import { dagMerge, type MergeOp, pullRemoteTree } from "@casfa/dag-diff";
import { applyMergeOps, createFsService } from "@casfa/fs";
import { nodeKeyToStorageKey, storageKeyToNodeKey } from "@casfa/protocol";
import type { MergeHandler } from "./sync-manager.ts";

// ============================================================================
// Types
// ============================================================================

export type CreateMergeHandlerOpts = {
  /** Local CAS storage (for reading base/ours nodes and writing fetched remote nodes) */
  storage: StorageProvider;
  /** Key provider for creating new nodes during merge apply */
  keyProvider: KeyProvider;
  /** Client for fetching remote nodes via navigated path */
  client: CasfaClient;
};

// ============================================================================
// Factory
// ============================================================================

/**
 * Create a MergeHandler that performs pull → merge → apply.
 *
 * Root keys passed to the handler are in `nod_xxx` format (from depot API).
 * Internally converts to storage keys (CB32) for dag-diff operations,
 * and back to node keys for fs operations.
 */
export function createMergeHandler(opts: CreateMergeHandlerOpts): MergeHandler {
  const { storage, keyProvider, client } = opts;

  return async ({ baseRoot, oursRoot, theirsRoot }) => {
    try {
      // Convert node keys → storage keys for dag-diff
      const baseStorageKey = nodeKeyToStorageKey(baseRoot);
      const oursStorageKey = nodeKeyToStorageKey(oursRoot);
      const theirsStorageKey = nodeKeyToStorageKey(theirsRoot);

      // Step 1: Pull remote (theirs) tree changes into local storage
      // Uses navigated-path API for authorization (only depot root is auth-checked)
      await pullRemoteTree(baseStorageKey, theirsStorageKey, {
        storage,
        fetchNode: async (navPath) => {
          // For root node: use get(); for children: use getNavigated()
          const result =
            navPath === ""
              ? await client.nodes.get(theirsRoot)
              : await client.nodes.getNavigated(theirsRoot, navPath);

          if (!result.ok) return null;
          return result.data;
        },
      });

      // Step 2: 3-way merge (base vs ours vs theirs)
      const mergeResult = await dagMerge(baseStorageKey, oursStorageKey, theirsStorageKey, {
        storage,
        // Use current time for both — both sides are "now" from client perspective
        oursTimestamp: Date.now(),
        theirsTimestamp: Date.now() - 1, // slight bias toward ours
      });

      if (mergeResult.operations.length === 0) {
        // No changes needed — ours already incorporates theirs
        return oursRoot;
      }

      // Step 3: Convert storage keys in MergeOps to node keys for fs
      const nodeKeyOps: MergeOp[] = mergeResult.operations.map((op) => {
        if (op.type === "remove") return op;
        return {
          ...op,
          nodeKey: storageKeyToNodeKey(op.nodeKey),
        };
      });

      // Step 4: Apply merge operations to produce new root
      const fs = createFsService({
        ctx: { storage, key: keyProvider },
      });

      const applyResult = await applyMergeOps(oursRoot, nodeKeyOps, fs);

      return applyResult.newRoot;
    } catch (err) {
      // Merge failed — return null to signal fallback to LWW
      console.warn("[MergeHandler] 3-way merge failed, falling back to LWW:", err);
      return null;
    }
  };
}
