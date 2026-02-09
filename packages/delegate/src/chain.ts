/**
 * Delegate chain utilities — pure functions.
 *
 * A chain is an ordered array of delegate IDs from root to self (inclusive).
 * Root delegate has chain = [selfId].
 * Child at depth N has chain = [rootId, ..., parentId, selfId] of length N+1.
 */

import { MAX_DEPTH } from "./constants.ts";

// ============================================================================
// Chain Building
// ============================================================================

/**
 * Build a child's chain by appending childId to the parent's chain.
 *
 * @param parentChain - The parent delegate's chain (root→parent).
 * @param childId - The new child delegate's ID.
 * @returns The child's chain [root, ..., parent, child].
 */
export function buildChain(parentChain: string[], childId: string): string[] {
  return [...parentChain, childId];
}

/**
 * Build the root delegate's chain (just [selfId]).
 *
 * @param selfId - The root delegate's ID.
 */
export function buildRootChain(selfId: string): string[] {
  return [selfId];
}

// ============================================================================
// Chain Queries
// ============================================================================

/**
 * Check if `ancestorId` appears in the given chain.
 * This means `ancestorId` is an ancestor-or-self of the chain owner.
 *
 * @param ancestorId - The delegate ID to look for.
 * @param chain - The delegate chain to search.
 * @returns `true` if ancestorId is in the chain.
 */
export function isAncestor(ancestorId: string, chain: string[]): boolean {
  return chain.includes(ancestorId);
}

/**
 * Get the depth implied by a chain.
 * Depth = chain.length - 1 (root has depth 0, chain length 1).
 *
 * @param chain - The delegate chain.
 * @returns The depth (0-based).
 */
export function chainDepth(chain: string[]): number {
  return chain.length - 1;
}

// ============================================================================
// Chain Validation
// ============================================================================

/**
 * Validate that a chain is structurally correct:
 *  - Non-empty
 *  - Length ≤ MAX_DEPTH + 1
 *  - No duplicate IDs
 *  - No empty-string entries
 *
 * @param chain - The delegate chain to validate.
 * @returns `true` if the chain is valid.
 */
export function isChainValid(chain: string[]): boolean {
  // Must be non-empty
  if (chain.length === 0) return false;

  // Depth cannot exceed MAX_DEPTH (chain length = depth + 1)
  if (chain.length > MAX_DEPTH + 1) return false;

  // No empty strings
  if (chain.some((id) => id.length === 0)) return false;

  // No duplicates
  const unique = new Set(chain);
  if (unique.size !== chain.length) return false;

  return true;
}

/**
 * Check if childChain is a proper extension of parentChain.
 * i.e., childChain starts with all elements of parentChain,
 * followed by exactly one more element (the child's own ID).
 *
 * @param parentChain - The parent's chain.
 * @param childChain - The child's chain to check.
 * @returns `true` if childChain is a valid direct child chain of parentChain.
 */
export function isDirectChildChain(
  parentChain: string[],
  childChain: string[],
): boolean {
  // Child chain must be exactly one element longer
  if (childChain.length !== parentChain.length + 1) return false;

  // All parent chain elements must match
  for (let i = 0; i < parentChain.length; i++) {
    if (childChain[i] !== parentChain[i]) return false;
  }

  return true;
}
