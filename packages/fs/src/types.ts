/**
 * @casfa/fs — Types
 *
 * Core type definitions for the filesystem layer.
 * All types are storage-agnostic — they depend only on CasContext.
 */

import type { CasNode, KeyProvider, StorageProvider } from "@casfa/core";

// ============================================================================
// Context — extends CasContext with fs-specific hooks
// ============================================================================

/**
 * Filesystem context.
 *
 * The base layer (`storage` + `hash`) comes from `@casfa/core`'s CasContext.
 * Two optional hooks allow server-side concerns (ownership bookkeeping,
 * depot lookup) to be injected without polluting the pure tree logic.
 */
export type FsContext = {
  /** CAS blob store (CB32 keys) */
  storage: StorageProvider;
  /** Key provider for content-addressed key computation */
  key: KeyProvider;

  /**
   * Maximum single-node (block) size in bytes.
   * Used by B-Tree splitting when writing large files.
   * Typically populated from server info `limits.maxNodeSize`.
   * Defaults to `DEFAULT_NODE_LIMIT` (1 MB) from `@casfa/core`.
   */
  nodeLimit?: number;

  /**
   * Optional upper bound on file size in bytes.
   * When set, `write()` will reject files exceeding this limit.
   * Useful for server-side enforcement (e.g. Lambda payload limit).
   * Defaults to unlimited (no cap).
   */
  maxFileSize?: number;

  /**
   * Called after a new node is stored via `storage.put`.
   * The server implementation uses this to update ownership / refcount / usage.
   * Browser implementations can leave this undefined (no-op).
   */
  onNodeStored?: (info: NodeStoredInfo) => Promise<void>;

  /**
   * Resolve a user-facing node key to a CB32 storage key.
   * - `nod_xxx` → strip prefix (always available)
   * - `dpt_xxx` → look up depot root (server-only)
   *
   * If not provided, only `nod_` keys are supported.
   */
  resolveNodeKey?: (nodeKey: string) => Promise<string | FsError>;
};

/** Information passed to the onNodeStored hook */
export type NodeStoredInfo = {
  storageKey: string;
  bytes: Uint8Array;
  hash: Uint8Array;
  kind: "dict" | "file" | "successor";
  logicalSize: number;
};

// ============================================================================
// Internal Types
// ============================================================================

/** Resolved path info for tree traversal */
export type ResolvedNode = {
  /** CB32 storage key of this node */
  hash: string;
  /** Decoded CAS node */
  node: CasNode;
  /** Name of this node (empty string for root) */
  name: string;
  /** Parent entries from root → this node's parent */
  parentPath: ParentEntry[];
};

/** A single entry in the parent path (root → parent chain) */
export type ParentEntry = {
  /** CB32 storage key */
  hash: string;
  /** Decoded node */
  node: CasNode;
  /** Index of the child we descended into */
  childIndex: number;
};

// ============================================================================
// Error Types
// ============================================================================

export type FsError = {
  code: string;
  status: number;
  message: string;
  details?: Record<string, unknown>;
};

/** Type guard for FsError */
export function isFsError(value: unknown): value is FsError {
  return (
    typeof value === "object" &&
    value !== null &&
    "code" in value &&
    "status" in value &&
    "message" in value
  );
}

/** Convenience constructor for FsError */
export function fsError(
  code: string,
  status: number,
  message: string,
  details?: Record<string, unknown>
): FsError {
  return { code, status, message, details };
}
