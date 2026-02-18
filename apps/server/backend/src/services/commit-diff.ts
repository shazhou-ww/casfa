/**
 * Commit Diff — compute a compact DAG diff summary for depot commits.
 *
 * Computes the diff between the previous root and new root, returning
 * up to MAX_COMMIT_DIFF_ENTRIES compact entries suitable for storage
 * in depot history.
 */

import { type DiffEntry, dagDiff } from "@casfa/dag-diff";
import { MAX_COMMIT_DIFF_ENTRIES, nodeKeyToStorageKey } from "@casfa/protocol";
import type { StorageProvider } from "@casfa/storage-core";
import type { CommitDiffEntry } from "../types.ts";

export type CommitDiffResult = {
  entries: CommitDiffEntry[];
  truncated: boolean;
};

/**
 * Convert a DiffEntry from dag-diff into the compact format stored in history.
 */
function toCommitDiffEntry(entry: DiffEntry): CommitDiffEntry {
  switch (entry.type) {
    case "added":
      return { type: "added", path: entry.path, kind: entry.kind, pathTo: null };
    case "removed":
      return { type: "removed", path: entry.path, kind: entry.kind, pathTo: null };
    case "modified":
      return { type: "modified", path: entry.path, kind: null, pathTo: null };
    case "moved":
      return {
        type: "moved",
        path: entry.pathsFrom[0] ?? "",
        kind: entry.kind,
        pathTo: entry.pathsTo[0] ?? "",
      };
  }
}

/**
 * Safely convert a node key (nod_ prefixed or raw storage key) to a storage key.
 */
function safeToStorageKey(key: string): string {
  try {
    return nodeKeyToStorageKey(key);
  } catch {
    // Already a raw storage key (legacy format)
    return key;
  }
}

/**
 * Compute a compact diff summary between two roots.
 *
 * Accepts node keys in any format (nod_ prefixed or raw storage keys).
 * Returns up to 5 diff entries and a truncated flag.
 * Returns null if diff cannot be computed (e.g. no previous root,
 * same root, or nodes not found in storage).
 */
export async function computeCommitDiff(
  oldRoot: string | null,
  newRoot: string,
  storage: StorageProvider
): Promise<CommitDiffResult | null> {
  // No diff possible if there's no previous root
  if (!oldRoot) {
    return null;
  }

  const oldKey = safeToStorageKey(oldRoot);
  const newKey = safeToStorageKey(newRoot);

  // Same root means no changes
  if (oldKey === newKey) {
    return null;
  }

  try {
    const result = await dagDiff(oldKey, newKey, {
      storage,
      maxEntries: MAX_COMMIT_DIFF_ENTRIES,
    });

    return {
      entries: result.entries.map(toCommitDiffEntry),
      truncated: result.truncated,
    };
  } catch {
    // If nodes are missing or decoding fails, skip diff gracefully
    return null;
  }
}
