/**
 * Collect Leaves — recursively enumerate all leaf entries under a d-node.
 *
 * Used when a name exists only on one side of the diff: we need to expand
 * the entire subtree into individual file/dir entries.
 */

import { decodeNode, hashToKey, isWellKnownNode, getWellKnownNodeData } from "@casfa/core";
import type { StorageProvider, CasNode } from "@casfa/core";
import type { AddedEntry, DiffEntryKind, RemovedEntry } from "./types.ts";

type Side = "added" | "removed";

/**
 * Fetch and decode a CAS node by key, consulting well-known nodes first.
 */
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

/**
 * Recursively collect all leaf entries (f-nodes and empty d-nodes) under a
 * node, yielding them as added or removed entries.
 *
 * - f-node → yield immediately (leaf file)
 * - d-node with children → recurse into each child
 * - d-node with 0 children → yield as empty dir
 * - set-node → throw
 * - successor-node → should not appear as d-node child; throw
 */
export async function* collectLeaves(
  storage: StorageProvider,
  nodeKey: string,
  basePath: string,
  side: Side,
): AsyncGenerator<AddedEntry | RemovedEntry> {
  const node = await fetchNode(storage, nodeKey);

  if (node.kind === "set") {
    throw new Error(`Unexpected set-node encountered at path "${basePath}" (key: ${nodeKey})`);
  }

  if (node.kind === "successor") {
    throw new Error(
      `Unexpected successor-node encountered at path "${basePath}" (key: ${nodeKey})`,
    );
  }

  if (node.kind === "file") {
    yield { type: side, path: basePath, nodeKey, kind: "file" as DiffEntryKind };
    return;
  }

  // dict node
  const children = node.children ?? [];
  const childNames = node.childNames ?? [];

  if (children.length === 0) {
    // Empty directory — report it as a leaf
    yield { type: side, path: basePath, nodeKey, kind: "dir" as DiffEntryKind };
    return;
  }

  for (let i = 0; i < children.length; i++) {
    const childHash = children[i]!;
    const childName = childNames[i]!;
    const childKey = hashToKey(childHash);
    const childPath = basePath === "" ? childName : `${basePath}/${childName}`;

    yield* collectLeaves(storage, childKey, childPath, side);
  }
}
