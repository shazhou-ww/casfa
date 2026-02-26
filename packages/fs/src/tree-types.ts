/**
 * @casfa/fs — Tree Types
 *
 * Types for the fs_tree operation — BFS directory tree with budget truncation.
 */

import type { PathSegment } from "@casfa/cas-uri";

// ============================================================================
// Tree Node Types
// ============================================================================

/** A directory node in the tree */
export type FsTreeDir = {
  /** CAS node key (nod_xxx) */
  hash: string;
  kind: "dir";
  /** Number of direct children (not recursive) */
  count: number;
  /** When true, directory was not expanded (depth/budget exceeded) */
  collapsed?: true;
  /** Child entries — present only when expanded (not collapsed) */
  children?: Record<string, FsTreeNode>;
};

/** A file node in the tree */
export type FsTreeFile = {
  /** CAS node key (nod_xxx) */
  hash: string;
  kind: "file";
  /** MIME content type */
  type: string;
  /** File size in bytes */
  size: number;
};

/** A node in the tree — either a file or a directory */
export type FsTreeNode = FsTreeDir | FsTreeFile;

/** Top-level response for tree() — root dir + truncation flag */
export type FsTreeResponse = FsTreeDir & {
  /** Whether any directories were collapsed due to budget exhaustion */
  truncated: boolean;
};

// ============================================================================
// Tree Options
// ============================================================================

/** Options for the tree() operation */
export type FsTreeOptions = {
  /** Path segments to start from (resolved relative to root) */
  path?: PathSegment[];
  /**
   * Max recursion depth. Directories beyond this depth are collapsed.
   * Default: 3. Use -1 for unlimited.
   */
  depth?: number;
  /**
   * Max total entries (files + directories) in the result.
   * When budget is exhausted, remaining directories are collapsed.
   * Default: 500. Max: 5000.
   */
  maxEntries?: number;
};
