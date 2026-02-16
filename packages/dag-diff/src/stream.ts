/**
 * DAG Diff Stream — core recursive diff algorithm.
 *
 * Produces a stream of RawDiffEntry (added / removed / modified) by
 * recursively comparing two d-node trees with hash-short-circuit
 * optimisation.
 */

import type { CasNode, StorageProvider } from "@casfa/core";
import { decodeNode, getWellKnownNodeData, hashToKey, isWellKnownNode } from "@casfa/core";
import { collectLeaves } from "./collect.ts";
import type { DagDiffOptions, DiffEntryKind, RawDiffEntry, TypeChange } from "./types.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function fetchNode(storage: StorageProvider, key: string): Promise<CasNode> {
  let bytes: Uint8Array | null = null;

  if (isWellKnownNode(key)) {
    bytes = getWellKnownNodeData(key) ?? null;
  }

  if (!bytes) {
    bytes = await storage.get(key);
  }

  if (!bytes) {
    throw new Error(`Node not found in storage: ${key}`);
  }

  return decodeNode(bytes);
}

function _nodeKindToDiffKind(kind: CasNode["kind"]): DiffEntryKind {
  return kind === "file" ? "file" : "dir";
}

// ---------------------------------------------------------------------------
// Merge-join helpers for sorted child names
// ---------------------------------------------------------------------------

type MergedChild =
  | { name: string; oldHash: Uint8Array; newHash: null } // only in old
  | { name: string; oldHash: null; newHash: Uint8Array } // only in new
  | { name: string; oldHash: Uint8Array; newHash: Uint8Array }; // in both

/**
 * Merge two sorted child-name lists, pairing entries with the same name.
 * Both lists MUST be sorted by UTF-8 byte order (guaranteed by CAS spec).
 */
function mergeChildren(
  oldNames: string[],
  oldHashes: Uint8Array[],
  newNames: string[],
  newHashes: Uint8Array[]
): MergedChild[] {
  const result: MergedChild[] = [];
  let i = 0;
  let j = 0;

  while (i < oldNames.length && j < newNames.length) {
    const oldName = oldNames[i]!;
    const newName = newNames[j]!;

    if (oldName < newName) {
      result.push({ name: oldName, oldHash: oldHashes[i]!, newHash: null });
      i++;
    } else if (oldName > newName) {
      result.push({ name: newName, oldHash: null, newHash: newHashes[j]! });
      j++;
    } else {
      // same name
      result.push({ name: oldName, oldHash: oldHashes[i]!, newHash: newHashes[j]! });
      i++;
      j++;
    }
  }

  while (i < oldNames.length) {
    result.push({ name: oldNames[i]!, oldHash: oldHashes[i]!, newHash: null });
    i++;
  }

  while (j < newNames.length) {
    result.push({ name: newNames[j]!, oldHash: null, newHash: newHashes[j]! });
    j++;
  }

  return result;
}

function hashesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Truncation state — shared across the recursive generator tree
// ---------------------------------------------------------------------------

type TruncationState = {
  count: number;
  maxEntries: number; // Infinity if unlimited
  truncated: boolean;
};

// ---------------------------------------------------------------------------
// Core streaming diff
// ---------------------------------------------------------------------------

/**
 * Streaming DAG diff entry point.
 *
 * Yields `RawDiffEntry` (added / removed / modified) — does NOT perform
 * moved detection. Use `dagDiff()` for the batch API with moved detection.
 */
export async function* dagDiffStream(
  oldRootKey: string,
  newRootKey: string,
  options: DagDiffOptions
): AsyncGenerator<RawDiffEntry> {
  // Trivial: same root ⇒ no changes
  if (oldRootKey === newRootKey) return;

  const state: TruncationState = {
    count: 0,
    maxEntries: options.maxEntries ?? Number.POSITIVE_INFINITY,
    truncated: false,
  };

  yield* diffNodes(oldRootKey, newRootKey, "", 0, options, state);
}

/**
 * Check whether the stream has been truncated (callable after iteration).
 * We expose truncation via a side-channel because generators cannot return
 * metadata alongside yielded values.
 *
 * The batch `dagDiff()` wraps this and includes `truncated` in `DiffResult`.
 */
export function createDiffStream(
  oldRootKey: string,
  newRootKey: string,
  options: DagDiffOptions
): { stream: AsyncGenerator<RawDiffEntry>; isTruncated: () => boolean } {
  const state: TruncationState = {
    count: 0,
    maxEntries: options.maxEntries ?? Number.POSITIVE_INFINITY,
    truncated: false,
  };

  async function* run(): AsyncGenerator<RawDiffEntry> {
    if (oldRootKey === newRootKey) return;
    yield* diffNodes(oldRootKey, newRootKey, "", 0, options, state);
  }

  return {
    stream: run(),
    isTruncated: () => state.truncated,
  };
}

// ---------------------------------------------------------------------------
// Recursive diff implementation
// ---------------------------------------------------------------------------

async function* diffNodes(
  oldKey: string,
  newKey: string,
  path: string,
  depth: number,
  options: DagDiffOptions,
  state: TruncationState
): AsyncGenerator<RawDiffEntry> {
  // Hash short-circuit
  if (oldKey === newKey) return;

  // Truncation check
  if (state.count >= state.maxEntries) {
    state.truncated = true;
    return;
  }

  const { storage, maxDepth } = options;

  const oldNode = await fetchNode(storage, oldKey);
  const newNode = await fetchNode(storage, newKey);

  // Reject set-nodes
  if (oldNode.kind === "set") {
    throw new Error(`Unexpected set-node at path "${path}" (old key: ${oldKey})`);
  }
  if (newNode.kind === "set") {
    throw new Error(`Unexpected set-node at path "${path}" (new key: ${newKey})`);
  }
  // Reject successor-nodes at root/child level (should never be direct d-node children)
  if (oldNode.kind === "successor") {
    throw new Error(`Unexpected successor-node at path "${path}" (old key: ${oldKey})`);
  }
  if (newNode.kind === "successor") {
    throw new Error(`Unexpected successor-node at path "${path}" (new key: ${newKey})`);
  }

  // Both are f-nodes → modified at file level
  if (oldNode.kind === "file" && newNode.kind === "file") {
    if (state.count >= state.maxEntries) {
      state.truncated = true;
      return;
    }
    state.count++;
    yield {
      type: "modified",
      path,
      oldNodeKey: oldKey,
      newNodeKey: newKey,
      typeChange: "none" as TypeChange,
    };
    return;
  }

  // Type mismatch: one is file, other is dict
  if (oldNode.kind !== newNode.kind) {
    const typeChange: TypeChange = oldNode.kind === "file" ? "file2dir" : "dir2file";

    if (state.count >= state.maxEntries) {
      state.truncated = true;
      return;
    }
    state.count++;
    yield {
      type: "modified",
      path,
      oldNodeKey: oldKey,
      newNodeKey: newKey,
      typeChange,
    };
    return;
  }

  // Both are d-nodes — recurse with merge-join
  // maxDepth check
  if (maxDepth !== undefined && depth >= maxDepth) {
    if (state.count >= state.maxEntries) {
      state.truncated = true;
      return;
    }
    state.count++;
    yield {
      type: "modified",
      path,
      oldNodeKey: oldKey,
      newNodeKey: newKey,
      typeChange: "none" as TypeChange,
    };
    return;
  }

  const oldNames = oldNode.childNames ?? [];
  const oldHashes = oldNode.children ?? [];
  const newNames = newNode.childNames ?? [];
  const newHashes = newNode.children ?? [];

  const merged = mergeChildren(oldNames, oldHashes, newNames, newHashes);

  for (const entry of merged) {
    if (state.count >= state.maxEntries) {
      state.truncated = true;
      return;
    }

    const childPath = path === "" ? entry.name : `${path}/${entry.name}`;

    if (entry.oldHash === null) {
      // Only in new → added
      const childKey = hashToKey(entry.newHash);
      yield* collectLeavesWithState(storage, childKey, childPath, "added", state);
    } else if (entry.newHash === null) {
      // Only in old → removed
      const childKey = hashToKey(entry.oldHash);
      yield* collectLeavesWithState(storage, childKey, childPath, "removed", state);
    } else if (!hashesEqual(entry.oldHash, entry.newHash)) {
      // Both exist, different hash → recurse
      const oldChildKey = hashToKey(entry.oldHash);
      const newChildKey = hashToKey(entry.newHash);
      yield* diffNodes(oldChildKey, newChildKey, childPath, depth + 1, options, state);
    }
    // else: same hash → skip (hash short-circuit)
  }
}

/**
 * Wrapper around collectLeaves that respects truncation state.
 */
async function* collectLeavesWithState(
  storage: StorageProvider,
  nodeKey: string,
  basePath: string,
  side: "added" | "removed",
  state: TruncationState
): AsyncGenerator<RawDiffEntry> {
  for await (const entry of collectLeaves(storage, nodeKey, basePath, side)) {
    if (state.count >= state.maxEntries) {
      state.truncated = true;
      return;
    }
    state.count++;
    yield entry;
  }
}
