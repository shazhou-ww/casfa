/**
 * Filesystem Service — Main Entry
 *
 * Creates the unified FsService by composing tree-ops, read-ops, and write-ops.
 * Re-exports all types needed by consumers (controller, app, tests).
 */

import { createReadOps } from "./read-ops.ts";
import { createTreeOps } from "./tree-ops.ts";
import type { FsServiceDeps } from "./types.ts";
import { createWriteOps } from "./write-ops.ts";

// ============================================================================
// Re-exports
// ============================================================================

export { type FsError, type FsServiceDeps, fsError, isFsError } from "./types.ts";

// ============================================================================
// Service Factory
// ============================================================================

export type FsService = ReturnType<typeof createFsService>;

export const createFsService = (deps: FsServiceDeps) => {
  const tree = createTreeOps(deps);
  const readOps = createReadOps(tree);
  const writeOps = createWriteOps(deps, tree);

  return {
    ...readOps,
    ...writeOps,
    resolveNodeKey: tree.resolveNodeKey,
  };
};
