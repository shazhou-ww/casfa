import type { PathSegment } from "@casfa/cas-uri";

/**
 * Delegate entity: bound to a path in the realm's file tree.
 * boundPath is name-only (no index segments); root delegate has empty boundPath.
 */
export type Delegate = {
  delegateId: string;
  realmId: string;
  /** null for root delegate */
  parentId: string | null;
  /** Name-only path segments; root = [] */
  boundPath: PathSegment[];
  name?: string;
  createdAt?: number;
};

/** Realm storage stats: node count and total bytes (reachable set). */
export type RealmStats = {
  nodeCount: number;
  totalBytes: number;
};
