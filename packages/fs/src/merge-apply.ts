/**
 * Apply Merge Operations — map `MergeOp[]` from `@casfa/dag-diff` to
 * the `@casfa/fs` `rewrite()` operation.
 *
 * This bridges the pure-computation merge output with the tree-writing layer.
 *
 * @packageDocumentation
 */

import type { FsRewriteEntry, FsRewriteResponse } from "@casfa/protocol";
import type { FsService } from "./index.ts";
import { isFsError } from "./types.ts";

// ============================================================================
// Types
// ============================================================================

/** A single merge operation (matches @casfa/dag-diff MergeOp). */
export type MergeOp =
  | { type: "add"; path: string; nodeKey: string }
  | { type: "remove"; path: string }
  | { type: "update"; path: string; nodeKey: string };

/** Result of applying merge operations */
export type ApplyMergeResult = {
  /** New root node key (nod_xxx format) */
  newRoot: string;
  /** Number of entries applied (add + update) */
  entriesApplied: number;
  /** Number of paths deleted */
  deleted: number;
};

// ============================================================================
// Implementation
// ============================================================================

/**
 * Apply merge operations to a root tree, producing a new merged root.
 *
 * Maps each `MergeOp` to a `rewrite()` call:
 * - `add`    → `{ link: nodeKey }` entry at `path`
 * - `update` → `{ link: nodeKey }` entry at `path`
 * - `remove` → delete at `path`
 *
 * The `rewrite()` function handles mkdir -p for intermediate directories
 * and Merkle path rebuilding.
 *
 * @param rootNodeKey  - Current root to apply operations on (nod_xxx format).
 * @param operations   - Merge operations from `dagMerge()`.
 * @param fs           - FsService instance (created from local storage + key provider).
 * @returns New root key and operation counts.
 * @throws Error if rewrite fails.
 */
export async function applyMergeOps(
  rootNodeKey: string,
  operations: MergeOp[],
  fs: FsService,
): Promise<ApplyMergeResult> {
  if (operations.length === 0) {
    return { newRoot: rootNodeKey, entriesApplied: 0, deleted: 0 };
  }

  // Partition into entries (add/update) and deletes (remove)
  const entries: Record<string, FsRewriteEntry> = {};
  const deletes: string[] = [];

  for (const op of operations) {
    switch (op.type) {
      case "add":
      case "update":
        entries[op.path] = { link: op.nodeKey };
        break;
      case "remove":
        deletes.push(op.path);
        break;
    }
  }

  // Call rewrite (handles mkdir -p, Merkle rebuild, etc.)
  const result = await fs.rewrite(rootNodeKey, entries, deletes);

  if (isFsError(result)) {
    throw new Error(`applyMergeOps failed: ${result.code} — ${result.message}`);
  }

  return {
    newRoot: (result as FsRewriteResponse).newRoot,
    entriesApplied: (result as FsRewriteResponse).entriesApplied,
    deleted: (result as FsRewriteResponse).deleted,
  };
}
