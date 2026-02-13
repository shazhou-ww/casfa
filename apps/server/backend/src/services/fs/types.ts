/**
 * Filesystem Service — Types
 *
 * Server-specific type definitions for the filesystem service adapter.
 * Pure tree types (ResolvedNode, ParentEntry, FsError etc.) live in @casfa/fs.
 */

import type { KeyProvider } from "@casfa/core";
import type { StorageProvider } from "@casfa/storage-core";
import type { DepotsDb } from "../../db/depots.ts";
import type { OwnershipV2Db } from "../../db/ownership-v2.ts";
import type { RefCountDb } from "../../db/refcount.ts";
import type { ScopeSetNodesDb } from "../../db/scope-set-nodes.ts";
import type { UsageDb } from "../../db/usage.ts";

// Re-export from @casfa/fs for backward compat
export { type FsError, fsError, isFsError } from "@casfa/fs";

// ============================================================================
// Service Dependencies
// ============================================================================

export type FsServiceDeps = {
  storage: StorageProvider;
  keyProvider: KeyProvider;
  ownershipV2Db: OwnershipV2Db;
  refCountDb: RefCountDb;
  usageDb: UsageDb;
  depotsDb: DepotsDb;
  scopeSetNodesDb: ScopeSetNodesDb;
  /** B-Tree node size limit (default: core's DEFAULT_NODE_LIMIT = 1MB) */
  nodeLimit?: number;
  /** Max file size for write operations (default: no limit) */
  maxFileSize?: number;
};
