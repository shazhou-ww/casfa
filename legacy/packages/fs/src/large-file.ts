/**
 * @casfa/fs — Large File Support
 *
 * Bridges FsContext → CasContext for multi-block file operations.
 *
 * The key challenge: `@casfa/core`'s `writeFile()` calls `storage.put()`
 * directly, bypassing FsContext's `onNodeStored` hook (used for ownership /
 * refcount tracking on the server). This module creates a wrapped
 * `CasContext` whose `storage.put()` automatically invokes `onNodeStored`
 * for every node written — including intermediate s-nodes created during
 * B-Tree splitting.
 */

import {
  type CasContext,
  DEFAULT_NODE_LIMIT,
  getNodeKind,
  openFileStream,
  readFile,
  type WriteResult,
  writeFile,
} from "@casfa/core";

import type { FsContext } from "./types.ts";

// ============================================================================
// CasContext Builder
// ============================================================================

/**
 * Build a `CasContext` from an `FsContext` with a storage wrapper that
 * invokes `onNodeStored` after every `put()`.
 *
 * This ensures that when `core.writeFile()` uploads s-nodes and the root
 * f-node, each node is properly tracked for ownership / refcount.
 */
export const buildCasContext = (ctx: FsContext): CasContext => {
  const { storage, key, onNodeStored, nodeLimit } = ctx;

  const wrappedStorage = {
    get: storage.get.bind(storage),
    put: async (storageKey: string, bytes: Uint8Array): Promise<void> => {
      await storage.put(storageKey, bytes);

      if (onNodeStored) {
        // Determine node kind from the raw bytes header
        const kind = getNodeKind(bytes);
        const nodeKind: "file" | "successor" | "dict" =
          kind === "successor" ? "successor" : kind === "dict" ? "dict" : "file";

        // Compute hash from the storage key (reverse of hashToKey)
        // We need the raw hash bytes for the hook — derive from storageKey
        // is not straightforward, so we use the key provider instead.
        const hash = await key.computeKey(bytes);

        // logicalSize: for file nodes this is the data payload size;
        // for the hook's purposes we pass bytes.length as a conservative estimate.
        const logicalSize = bytes.length;

        await onNodeStored({
          storageKey,
          bytes,
          hash,
          kind: nodeKind,
          logicalSize,
        });
      }
    },
    del: (key: string) => storage.del(key),
  };

  return {
    storage: wrappedStorage,
    key,
    nodeLimit: nodeLimit ?? DEFAULT_NODE_LIMIT,
  };
};

// ============================================================================
// Large File Write
// ============================================================================

/**
 * Write a large file using B-Tree splitting via `@casfa/core`.
 *
 * Returns the root f-node's hash bytes and the WriteResult metadata.
 * The caller is responsible for inserting the root hash into the directory tree.
 */
export const writeLargeFile = async (
  ctx: FsContext,
  data: Uint8Array,
  contentType: string
): Promise<WriteResult> => {
  const casCtx = buildCasContext(ctx);
  return writeFile(casCtx, data, contentType);
};

// ============================================================================
// Large File Read
// ============================================================================

/**
 * Read a multi-block file by traversing the B-Tree.
 *
 * Returns the full reassembled file content as a single Uint8Array.
 * For memory-efficient streaming, use `streamLargeFile` instead.
 */
export const readLargeFile = async (
  ctx: FsContext,
  storageKey: string
): Promise<Uint8Array | null> => {
  const casCtx = buildCasContext(ctx);
  return readFile(casCtx, storageKey);
};

/**
 * Open a multi-block file as a ReadableStream.
 *
 * Streams data chunk-by-chunk via DFS pre-order traversal of the B-Tree.
 * Memory-efficient — doesn't load the entire file into memory.
 */
export const streamLargeFile = (ctx: FsContext, storageKey: string): ReadableStream<Uint8Array> => {
  const casCtx = buildCasContext(ctx);
  return openFileStream(casCtx, storageKey);
};
