/**
 * Commit Diff — compute a compact DAG diff summary for depot commits.
 *
 * Computes the diff between the previous root and new root, returning
 * up to MAX_COMMIT_DIFF_ENTRIES compact entries suitable for storage
 * in depot history.
 */

import { dagDiff, type DiffEntry } from "@casfa/dag-diff";
import { MAX_COMMIT_DIFF_ENTRIES } from "@casfa/protocol";
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
      return { type: "added", path: entry.path, kind: entry.kind };
    case "removed":
      return { type: "removed", path: entry.path, kind: entry.kind };
    case "modified":
      return { type: "modified", path: entry.path };
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
 * Compute a compact diff summary between two roots (storage keys).
 *
 * Returns up to 5 diff entries and a truncated flag.
 * Returns null if diff cannot be computed (e.g. no previous root,
 * same root, or nodes not found in storage).
 */
export async function computeCommitDiff(
  oldRootStorageKey: string | null,
  newRootStorageKey: string,
  storage: StorageProvider
): Promise<CommitDiffResult | null> {
  // No diff possible if there's no previous root or roots are identical
  if (!oldRootStorageKey || oldRootStorageKey === newRootStorageKey) {
    return null;
  }

  try {
    const result = await dagDiff(oldRootStorageKey, newRootStorageKey, {
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
