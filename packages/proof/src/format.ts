/**
 * Format utilities for constructing X-CAS-Proof header values.
 *
 * Used by clients to build proof headers for API requests.
 *
 * See ownership-and-permissions.md §5.2
 */

import type { DepotProofWord, IPathProofWord, ProofWord } from "./types.ts";

// ============================================================================
// ProofWord formatting
// ============================================================================

/**
 * Format an IPathProofWord back to its string representation.
 *
 * @example
 *   formatProofWord({ type: "ipath", scopeIndex: 0, path: [1, 2] })
 *   // → "ipath#0:1:2"
 */
export function formatIPathProofWord(word: IPathProofWord): string {
  const indices = [word.scopeIndex, ...word.path];
  return `ipath#${indices.join(":")}`;
}

/**
 * Format a DepotProofWord back to its string representation.
 *
 * @example
 *   formatDepotProofWord({ type: "depot", depotId: "d1", version: "v1", path: [0, 1] })
 *   // → "depot:d1@v1#0:1"
 */
export function formatDepotProofWord(word: DepotProofWord): string {
  const indices = word.path.join(":");
  return `depot:${word.depotId}@${word.version}#${indices}`;
}

/**
 * Format any ProofWord to its string representation.
 */
export function formatProofWord(word: ProofWord): string {
  if (word.type === "ipath") return formatIPathProofWord(word);
  return formatDepotProofWord(word);
}

// ============================================================================
// Header formatting
// ============================================================================

/**
 * Build an X-CAS-Proof header value from a map of nodeHash → ProofWord.
 *
 * @param entries - Array of `[nodeHash, ProofWord]` pairs
 * @returns JSON string suitable for the X-CAS-Proof header
 *
 * @example
 *   formatProofHeader([
 *     ["abc123", { type: "ipath", scopeIndex: 0, path: [1, 2] }],
 *     ["def456", { type: "ipath", scopeIndex: 0, path: [3] }],
 *   ])
 *   // → '{"abc123":"ipath#0:1:2","def456":"ipath#0:3"}'
 */
export function formatProofHeader(
  entries: ReadonlyArray<readonly [string, ProofWord]>,
): string {
  const obj: Record<string, string> = {};
  for (const [nodeHash, word] of entries) {
    obj[nodeHash] = formatProofWord(word);
  }
  return JSON.stringify(obj);
}

// ============================================================================
// Convenience builders
// ============================================================================

/**
 * Create an ipath ProofWord.
 *
 * @param scopeIndex - Index of the scope root (0 for single scope)
 * @param path       - Child indices at each tree level
 */
export function ipath(scopeIndex: number, ...path: number[]): IPathProofWord {
  return { type: "ipath", scopeIndex, path };
}

/**
 * Create a depot-version ProofWord.
 *
 * @param depotId - Depot identifier
 * @param version - Version string
 * @param path    - Child indices at each tree level
 */
export function depot(
  depotId: string,
  version: string,
  ...path: number[]
): DepotProofWord {
  return { type: "depot", depotId, version, path };
}
