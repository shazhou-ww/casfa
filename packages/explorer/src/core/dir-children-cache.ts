/**
 * Global LRU cache: CAS node key → has child directories.
 *
 * CAS nodes are immutable — a given node key always represents the same
 * content. So "does directory X have subdirectories?" is a permanent fact
 * once observed. Any opportunity to inspect node children (ls, expand,
 * navigate) can feed this cache.
 *
 * The cache is a module-level singleton shared across all explorer
 * instances in the same JS context.
 *
 * @packageDocumentation
 */

// ============================================================================
// Constants
// ============================================================================

const MAX_SIZE = 4096;

// ============================================================================
// Cache (Map preserves insertion order → LRU via delete-then-set)
// ============================================================================

const cache = new Map<string, boolean>();

// ============================================================================
// Public API
// ============================================================================

/**
 * Look up whether a directory node has child directories.
 *
 * @returns `true` / `false` if known, `undefined` if not yet observed.
 */
export function hasChildDirs(nodeKey: string): boolean | undefined {
  return cache.get(nodeKey);
}

/**
 * Populate the cache from an `ls` result.
 *
 * Call this every time a directory listing is obtained — navigate, refresh,
 * tree expand, loadMore, etc.
 *
 * @param dirKey            CAS key of the listed directory (`result.key`).
 * @param children          Children entries from this page.
 * @param isCompleteListing `true` when this single response covers **all**
 *                          children (i.e. `nextCursor === null` and no prior
 *                          pages were fetched separately). When `false`, we
 *                          can still assert `true` if dirs are found, but
 *                          cannot assert `false` (unseen pages may contain
 *                          directories).
 */
export function updateFromLsResult(
  dirKey: string,
  children: readonly { type: string; key: string; childCount?: number }[],
  isCompleteListing: boolean,
): void {
  const hasDirs = children.some((c) => c.type === "dir");

  if (hasDirs) {
    cacheSet(dirKey, true);
  } else if (isCompleteListing) {
    cacheSet(dirKey, false);
  }
  // else: partial page with no dirs seen yet → leave unknown

  // Child dirs with zero total children → definitely no child dirs
  for (const c of children) {
    if (c.type === "dir" && c.childCount === 0) {
      cacheSet(c.key, false);
    }
  }
}

// ============================================================================
// Internal
// ============================================================================

function cacheSet(key: string, value: boolean): void {
  // Never downgrade true → false (immutable content, once true always true)
  if (!value && cache.get(key) === true) return;

  cache.delete(key); // remove old position
  cache.set(key, value);

  // Evict LRU if over capacity
  if (cache.size > MAX_SIZE) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
}
