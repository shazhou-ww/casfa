/**
 * Filesystem Service — Types
 *
 * Shared type definitions for the filesystem service modules.
 */

import type { CasNode, HashProvider } from "@casfa/core";
import type { StorageProvider } from "@casfa/storage-core";
import type { DepotsDb } from "../../db/depots.ts";
import type { OwnershipDb } from "../../db/ownership.ts";
import type { RefCountDb } from "../../db/refcount.ts";
import type { ScopeSetNodesDb } from "../../db/scope-set-nodes.ts";
import type { UsageDb } from "../../db/usage.ts";

// ============================================================================
// Service Dependencies
// ============================================================================

export type FsServiceDeps = {
  storage: StorageProvider;
  hashProvider: HashProvider;
  ownershipDb: OwnershipDb;
  refCountDb: RefCountDb;
  usageDb: UsageDb;
  depotsDb: DepotsDb;
  scopeSetNodesDb: ScopeSetNodesDb;
};

// ============================================================================
// Internal Types
// ============================================================================

/** Internal node reference: hash in hex format */
export type NodeRef = string;

/** Resolved path info for tree traversal */
export type ResolvedNode = {
  hash: NodeRef;
  node: CasNode;
  name: string;
  /** Parent entries from root to this node's parent */
  parentPath: ParentEntry[];
};

/** A single entry in the parent path (root → parent chain) */
export type ParentEntry = {
  hash: NodeRef;
  node: CasNode;
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
