/**
 * DAG Diff — batch API with moved detection.
 *
 * Collects the raw streaming diff, then post-processes to detect moved
 * entries (same nodeKey appearing in both added and removed sets).
 */

import { createDiffStream } from "./stream.ts";
import type {
  AddedEntry,
  DagDiffOptions,
  DiffEntry,
  DiffResult,
  DiffStats,
  MovedEntry,
  RawDiffEntry,
  RemovedEntry,
} from "./types.ts";

/**
 * Compute the diff between two CAS DAG roots.
 *
 * Returns a `DiffResult` with all entries (including moved detection)
 * and aggregate statistics.
 */
export async function dagDiff(
  oldRootKey: string,
  newRootKey: string,
  options: DagDiffOptions
): Promise<DiffResult> {
  const { stream, isTruncated } = createDiffStream(oldRootKey, newRootKey, options);

  // Collect all raw entries
  const rawEntries: RawDiffEntry[] = [];
  for await (const entry of stream) {
    rawEntries.push(entry);
  }

  // Post-process: detect moves
  const entries = detectMoves(rawEntries);
  const truncated = isTruncated();

  // Compute stats
  const stats: DiffStats = { added: 0, removed: 0, modified: 0, moved: 0 };
  for (const e of entries) {
    switch (e.type) {
      case "added":
        stats.added++;
        break;
      case "removed":
        stats.removed++;
        break;
      case "modified":
        stats.modified++;
        break;
      case "moved":
        stats.moved++;
        break;
    }
  }

  return { entries, truncated, stats };
}

// ---------------------------------------------------------------------------
// Moved detection
// ---------------------------------------------------------------------------

/**
 * Detect moved entries by matching nodeKeys across added and removed sets.
 *
 * For each nodeKey that appears in BOTH added and removed:
 * - All added paths and all removed paths for that key are grouped into
 *   a single MovedEntry with `pathsFrom` (removed) and `pathsTo` (added).
 * - These entries are removed from the added/removed lists.
 *
 * Modified entries pass through unchanged.
 */
function detectMoves(raw: RawDiffEntry[]): DiffEntry[] {
  // Separate by type
  const added: AddedEntry[] = [];
  const removed: RemovedEntry[] = [];
  const modified: DiffEntry[] = [];

  for (const entry of raw) {
    switch (entry.type) {
      case "added":
        added.push(entry);
        break;
      case "removed":
        removed.push(entry);
        break;
      case "modified":
        modified.push(entry);
        break;
    }
  }

  // Index added and removed by nodeKey
  const addedByKey = new Map<string, AddedEntry[]>();
  for (const entry of added) {
    let list = addedByKey.get(entry.nodeKey);
    if (!list) {
      list = [];
      addedByKey.set(entry.nodeKey, list);
    }
    list.push(entry);
  }

  const removedByKey = new Map<string, RemovedEntry[]>();
  for (const entry of removed) {
    let list = removedByKey.get(entry.nodeKey);
    if (!list) {
      list = [];
      removedByKey.set(entry.nodeKey, list);
    }
    list.push(entry);
  }

  // Find keys present in both maps → moved
  const movedKeys = new Set<string>();
  for (const key of addedByKey.keys()) {
    if (removedByKey.has(key)) {
      movedKeys.add(key);
    }
  }

  const movedEntries: MovedEntry[] = [];
  for (const nodeKey of movedKeys) {
    const removedList = removedByKey.get(nodeKey)!;
    const addedList = addedByKey.get(nodeKey)!;

    // All entries for this key share the same kind (file or dir)
    const kind = removedList[0]!.kind;

    movedEntries.push({
      type: "moved",
      pathsFrom: removedList.map((e) => e.path),
      pathsTo: addedList.map((e) => e.path),
      nodeKey,
      kind,
    });

    // Remove from indexed maps so remaining entries stay as added/removed
    addedByKey.delete(nodeKey);
    removedByKey.delete(nodeKey);
  }

  // Assemble final result: remaining added + remaining removed + modified + moved
  const result: DiffEntry[] = [];

  for (const list of removedByKey.values()) {
    for (const entry of list) {
      result.push(entry);
    }
  }

  for (const list of addedByKey.values()) {
    for (const entry of list) {
      result.push(entry);
    }
  }

  result.push(...modified);
  result.push(...movedEntries);

  // Sort: removed, added, modified, moved — then by path
  result.sort((a, b) => {
    const typeOrder = { removed: 0, added: 1, modified: 2, moved: 3 };
    const ta = typeOrder[a.type];
    const tb = typeOrder[b.type];
    if (ta !== tb) return ta - tb;

    const pa = a.type === "moved" ? (a.pathsFrom[0] ?? "") : a.path;
    const pb = b.type === "moved" ? (b.pathsFrom[0] ?? "") : b.path;
    return pa.localeCompare(pb);
  });

  return result;
}
