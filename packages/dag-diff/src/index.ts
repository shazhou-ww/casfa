/**
 * @casfa/dag-diff — DAG diff at file-system granularity
 *
 * Compare two CAS DAG roots and produce a list of added, removed,
 * modified, and moved entries at the f-node (file) level.
 *
 * @example
 * ```ts
 * import { dagDiff, dagDiffStream } from "@casfa/dag-diff";
 *
 * // Batch API (with moved detection)
 * const result = await dagDiff(oldRootKey, newRootKey, { storage });
 * for (const entry of result.entries) { ... }
 *
 * // Streaming API (no moved detection)
 * for await (const entry of dagDiffStream(oldRootKey, newRootKey, { storage })) { ... }
 * ```
 */

export { dagDiff } from "./diff.ts";
export { dagMerge } from "./merge.ts";
export { dagDiffStream, createDiffStream } from "./stream.ts";
export type {
  AddedEntry,
  DagDiffOptions,
  DiffEntry,
  DiffEntryKind,
  DiffResult,
  DiffStats,
  LwwResolution,
  MergeOp,
  MergeOptions,
  MergeResult,
  ModifiedEntry,
  MovedEntry,
  RawDiffEntry,
  RemovedEntry,
  TypeChange,
} from "./types.ts";
