/**
 * @casfa/fs
 *
 * CAS filesystem operations on top of StorageProvider + KeyProvider.
 *
 * This package extracts the pure tree-manipulation logic from the server's
 * filesystem service. It depends only on @casfa/core (CasContext) and
 * @casfa/protocol (types), with no database or HTTP dependencies.
 *
 * Server-specific concerns (ownership, refcount, depot lookup, link
 * authorization) are injected via optional hooks in FsContext.
 *
 * @packageDocumentation
 */

import { createReadOps } from "./read-ops.ts";
import { createTreeOps } from "./tree-ops.ts";
import type { FsContext } from "./types.ts";
import { type AuthorizeLinkFn, createWriteOps } from "./write-ops.ts";

// ============================================================================
// Re-exports
// ============================================================================

export {
  findChildByIndex,
  findChildByName,
  hashToStorageKey,
  parseIndexPath,
  parsePath,
  storageKeyToHash,
} from "./helpers.ts";
export type { ReadOps } from "./read-ops.ts";

export type { TreeOps } from "./tree-ops.ts";
export {
  type FsContext,
  type FsError,
  fsError,
  isFsError,
  type NodeStoredInfo,
  type ParentEntry,
  type ResolvedNode,
} from "./types.ts";
export type { AuthorizeLinkFn, WriteOps } from "./write-ops.ts";

// ============================================================================
// Service Factory
// ============================================================================

export type FsService = ReturnType<typeof createFsService>;

export type CreateFsServiceOpts = {
  ctx: FsContext;
  /**
   * Optional authorization hook for rewrite `link` entries.
   * Server provides this to check ownership / scope proofs.
   */
  authorizeLink?: AuthorizeLinkFn;
};

export const createFsService = (opts: CreateFsServiceOpts) => {
  const { ctx, authorizeLink } = opts;
  const tree = createTreeOps(ctx);
  const readOps = createReadOps(tree);
  const writeOps = createWriteOps(ctx, tree, authorizeLink);

  return {
    ...readOps,
    ...writeOps,
    resolveNodeKey: tree.resolveNodeKey,
    /** Exposed for advanced usage (direct tree manipulation) */
    tree,
  };
};
