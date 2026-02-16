/**
 * DAG 3-Way Merge — LWW conflict resolution
 *
 * Given a common base and two diverged versions (ours / theirs), computes
 * the set of operations needed to produce the merged tree:
 *
 *   1. Diff base → ours
 *   2. Diff base → theirs
 *   3. Combine diffs by path, resolving conflicts via Last-Writer-Wins
 *
 * Merge rules per path:
 *
 * | ours ╲ theirs | (none)        | added          | removed       | modified       |
 * |---------------|---------------|----------------|---------------|----------------|
 * | (none)        | —             | add(theirs)    | remove        | update(theirs) |
 * | added         | add(ours)     | LWW if ≠ key   | (impossible)  | (impossible)   |
 * | removed       | remove        | (impossible)   | remove        | LWW            |
 * | modified      | update(ours)  | (impossible)   | LWW           | LWW if ≠ key   |
 *
 * LWW tiebreaker: ours wins when timestamps are equal.
 */

import { dagDiffStream } from "./stream.ts";
import type {
  AddedEntry,
  LwwResolution,
  MergeOp,
  MergeOptions,
  MergeResult,
  ModifiedEntry,
  RawDiffEntry,
  RemovedEntry,
} from "./types.ts";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compute a 3-way merge between two versions that diverged from a common base.
 *
 * @param baseRootKey  - Common ancestor root key
 * @param oursRootKey  - "Ours" version root key
 * @param theirsRootKey - "Theirs" version root key
 * @param options      - Merge options (storage + timestamps)
 * @returns Operations to apply to base to produce the merged tree, plus
 *          a record of any LWW conflict resolutions.
 */
export async function dagMerge(
  baseRootKey: string,
  oursRootKey: string,
  theirsRootKey: string,
  options: MergeOptions,
): Promise<MergeResult> {
  const { storage, oursTimestamp, theirsTimestamp, maxDepth, maxEntries } = options;

  const diffOptions = { storage, maxDepth, maxEntries };

  // Fast paths
  if (baseRootKey === oursRootKey && baseRootKey === theirsRootKey) {
    return { operations: [], resolutions: [] };
  }
  if (baseRootKey === oursRootKey) {
    // Ours didn't change — just take theirs diff as-is
    return applyOneSide(baseRootKey, theirsRootKey, diffOptions);
  }
  if (baseRootKey === theirsRootKey) {
    // Theirs didn't change — just take ours diff as-is
    return applyOneSide(baseRootKey, oursRootKey, diffOptions);
  }
  if (oursRootKey === theirsRootKey) {
    // Both converged to the same state — take either side
    return applyOneSide(baseRootKey, oursRootKey, diffOptions);
  }

  // Compute both diffs concurrently
  const [oursDiff, theirsDiff] = await Promise.all([
    collectRawDiff(baseRootKey, oursRootKey, diffOptions),
    collectRawDiff(baseRootKey, theirsRootKey, diffOptions),
  ]);

  // Index by path
  const oursMap = indexByPath(oursDiff);
  const theirsMap = indexByPath(theirsDiff);

  // Collect all affected paths
  const allPaths = new Set<string>([...oursMap.keys(), ...theirsMap.keys()]);

  const operations: MergeOp[] = [];
  const resolutions: LwwResolution[] = [];

  const oursWins = oursTimestamp >= theirsTimestamp;

  for (const path of allPaths) {
    const ours = oursMap.get(path);
    const theirs = theirsMap.get(path);

    if (ours && !theirs) {
      // Only ours changed this path
      operations.push(rawEntryToOp(ours));
    } else if (!ours && theirs) {
      // Only theirs changed this path
      operations.push(rawEntryToOp(theirs));
    } else if (ours && theirs) {
      // Both changed the same path — resolve
      const resolved = resolveConflict(path, ours, theirs, oursWins);
      if (resolved.op) operations.push(resolved.op);
      if (resolved.resolution) resolutions.push(resolved.resolution);
    }
  }

  // Sort operations by path for deterministic output
  operations.sort((a, b) => a.path.localeCompare(b.path));
  resolutions.sort((a, b) => a.path.localeCompare(b.path));

  return { operations, resolutions };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Collect raw diff entries (no moved detection) into an array */
async function collectRawDiff(
  oldKey: string,
  newKey: string,
  options: { storage: import("@casfa/core").StorageProvider; maxDepth?: number; maxEntries?: number },
): Promise<RawDiffEntry[]> {
  const entries: RawDiffEntry[] = [];
  for await (const entry of dagDiffStream(oldKey, newKey, options)) {
    entries.push(entry);
  }
  return entries;
}

/** Index raw diff entries by path */
function indexByPath(entries: RawDiffEntry[]): Map<string, RawDiffEntry> {
  const map = new Map<string, RawDiffEntry>();
  for (const entry of entries) {
    map.set(entry.path, entry);
  }
  return map;
}

/** Convert a raw diff entry into a merge operation */
function rawEntryToOp(entry: RawDiffEntry): MergeOp {
  switch (entry.type) {
    case "added":
      return { type: "add", path: entry.path, nodeKey: entry.nodeKey };
    case "removed":
      return { type: "remove", path: entry.path };
    case "modified":
      return { type: "update", path: entry.path, nodeKey: entry.newNodeKey };
  }
}

/** Get the "new" nodeKey from a diff entry (the key in the changed version) */
function getNewKey(entry: RawDiffEntry): string | null {
  switch (entry.type) {
    case "added":
      return entry.nodeKey;
    case "removed":
      return null;
    case "modified":
      return entry.newNodeKey;
  }
}

/** Resolve a conflict where both sides changed the same path */
function resolveConflict(
  path: string,
  ours: RawDiffEntry,
  theirs: RawDiffEntry,
  oursWins: boolean,
): { op: MergeOp | null; resolution: LwwResolution | null } {
  const oursKey = getNewKey(ours);
  const theirsKey = getNewKey(theirs);

  // Both did the same thing → no conflict
  if (oursKey === theirsKey) {
    // Both added/modified to same key, or both removed
    return { op: rawEntryToOp(ours), resolution: null };
  }

  // Determine conflict type
  let conflict: LwwResolution["conflict"];

  if (ours.type === "added" && theirs.type === "added") {
    conflict = "both-added";
  } else if (ours.type === "modified" && theirs.type === "modified") {
    conflict = "both-modified";
  } else {
    // One is modified/added and the other is removed, or vice versa
    conflict = "modify-remove";
  }

  const winner = oursWins ? "ours" : "theirs";
  const winnerEntry = oursWins ? ours : theirs;

  const resolution: LwwResolution = {
    path,
    winner,
    conflict,
    oursNodeKey: oursKey,
    theirsNodeKey: theirsKey,
  };

  return { op: rawEntryToOp(winnerEntry), resolution };
}

/** Fast path: only one side diverged from base — convert its diff to operations */
async function applyOneSide(
  baseKey: string,
  changedKey: string,
  options: { storage: import("@casfa/core").StorageProvider; maxDepth?: number; maxEntries?: number },
): Promise<MergeResult> {
  const entries = await collectRawDiff(baseKey, changedKey, options);
  const operations = entries.map(rawEntryToOp);
  operations.sort((a, b) => a.path.localeCompare(b.path));
  return { operations, resolutions: [] };
}
