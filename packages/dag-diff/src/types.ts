/**
 * DAG Diff Types
 *
 * Type definitions for comparing two CAS DAG roots at file-system granularity.
 */

import type { StorageProvider } from "@casfa/core";

// ---------------------------------------------------------------------------
// Diff entry types
// ---------------------------------------------------------------------------

/** Node kind from the file-system perspective */
export type DiffEntryKind = "file" | "dir";

/** Type-change qualifier for modified entries */
export type TypeChange = "none" | "file2dir" | "dir2file";

/** A file or directory that exists only in the new tree */
export type AddedEntry = {
  type: "added";
  path: string;
  nodeKey: string;
  kind: DiffEntryKind;
};

/** A file or directory that exists only in the old tree */
export type RemovedEntry = {
  type: "removed";
  path: string;
  nodeKey: string;
  kind: DiffEntryKind;
};

/** A path whose content key changed between old and new */
export type ModifiedEntry = {
  type: "modified";
  path: string;
  oldNodeKey: string;
  newNodeKey: string;
  typeChange: TypeChange;
};

/** Paths that were moved/renamed (same nodeKey, different paths) */
export type MovedEntry = {
  type: "moved";
  pathsFrom: string[];
  pathsTo: string[];
  nodeKey: string;
  kind: DiffEntryKind;
};

/** Union of all diff entry types produced by the streaming API */
export type RawDiffEntry = AddedEntry | RemovedEntry | ModifiedEntry;

/** Union of all diff entry types (including moved, from batch API) */
export type DiffEntry = RawDiffEntry | MovedEntry;

// ---------------------------------------------------------------------------
// Result & options
// ---------------------------------------------------------------------------

/** Aggregate statistics */
export type DiffStats = {
  added: number;
  removed: number;
  modified: number;
  moved: number;
};

/** Batch diff result */
export type DiffResult = {
  entries: DiffEntry[];
  /** Whether the result was truncated due to maxEntries */
  truncated: boolean;
  stats: DiffStats;
};

/** Options for dagDiff / dagDiffStream */
export type DagDiffOptions = {
  storage: StorageProvider;
  /**
   * Maximum d-node nesting depth to recurse into.
   * When reached, a changed sub-directory is reported as a single
   * `modified` entry without further expansion.
   * Default: unlimited.
   */
  maxDepth?: number;
  /**
   * Maximum number of entries to emit before stopping.
   * When reached, `DiffResult.truncated` is set to `true`.
   * Default: unlimited.
   */
  maxEntries?: number;
};

// ---------------------------------------------------------------------------
// 3-way merge types
// ---------------------------------------------------------------------------

/** Options for dagMerge */
export type MergeOptions = {
  storage: StorageProvider;
  /** Timestamp of the "ours" version (for LWW conflict resolution) */
  oursTimestamp: number;
  /** Timestamp of the "theirs" version (for LWW conflict resolution) */
  theirsTimestamp: number;
  /** Max d-node nesting depth (forwarded to diff) */
  maxDepth?: number;
  /** Max diff entries per side (forwarded to diff) */
  maxEntries?: number;
};

/** A single merge operation to apply to the base tree */
export type MergeOp =
  | { type: "add"; path: string; nodeKey: string }
  | { type: "remove"; path: string }
  | { type: "update"; path: string; nodeKey: string };

/** Record of an automatic LWW conflict resolution */
export type LwwResolution = {
  path: string;
  /** Which side won */
  winner: "ours" | "theirs";
  /** What kind of conflict was resolved */
  conflict:
    | "both-added"      // both added same path with different keys
    | "both-modified"   // both modified same path to different keys
    | "modify-remove";  // one modified, other removed
  oursNodeKey: string | null;
  theirsNodeKey: string | null;
};

/** Result of a 3-way merge */
export type MergeResult = {
  /** Operations to apply to the base tree to produce the merged tree */
  operations: MergeOp[];
  /** Automatic LWW conflict resolutions that were made */
  resolutions: LwwResolution[];
};
