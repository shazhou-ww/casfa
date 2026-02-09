/**
 * Parse the X-CAS-Proof header value into a ProofMap.
 *
 * Header format (JSON):
 *   `{"abc123":"ipath#0:1:2","def456":"depot:DEPOT_ID@VERSION#0:3"}`
 *
 * See ownership-and-permissions.md §5.2
 */

import type { DepotProofWord, IPathProofWord, ProofMap, ProofWord } from "./types.ts";

// ============================================================================
// Internal helpers
// ============================================================================

const IPATH_PREFIX = "ipath#";
const DEPOT_PREFIX = "depot:";

/**
 * Parse a colon-separated index path string into an array of non-negative
 * integers.
 *
 * @returns The parsed indices, or null if malformed.
 */
export function parseIndexPath(raw: string): number[] | null {
  if (!raw || raw.length === 0) return null;

  const parts = raw.split(":");
  const indices: number[] = [];

  for (const part of parts) {
    const n = Number(part);
    if (!Number.isInteger(n) || n < 0) return null;
    indices.push(n);
  }

  return indices.length > 0 ? indices : null;
}

// ============================================================================
// ProofWord parsing
// ============================================================================

/**
 * Parse a single proof word string into a ProofWord.
 *
 * Formats:
 * - `"ipath#0:1:2"` → IPathProofWord
 * - `"depot:DEPOT_ID@VERSION#0:1:2"` → DepotProofWord
 *
 * @returns Parsed ProofWord, or null if malformed.
 */
export function parseProofWord(raw: string): ProofWord | null {
  if (!raw || raw.length === 0) return null;

  // ipath format: "ipath#<scopeIndex>:<path...>"
  if (raw.startsWith(IPATH_PREFIX)) {
    return parseIPathProofWord(raw.slice(IPATH_PREFIX.length));
  }

  // depot format: "depot:<depotId>@<version>#<scopeIndex>:<path...>"
  if (raw.startsWith(DEPOT_PREFIX)) {
    return parseDepotProofWord(raw.slice(DEPOT_PREFIX.length));
  }

  return null;
}

/**
 * Parse ipath portion: "0:1:2" → IPathProofWord
 */
function parseIPathProofWord(raw: string): IPathProofWord | null {
  const indices = parseIndexPath(raw);
  if (!indices || indices.length === 0) return null;

  return {
    type: "ipath",
    scopeIndex: indices[0]!,
    path: indices.slice(1),
  };
}

/**
 * Parse depot portion: "DEPOT_ID@VERSION#0:1:2" → DepotProofWord
 */
function parseDepotProofWord(raw: string): DepotProofWord | null {
  // Split on "#" to separate depot specifier from index-path
  const hashIdx = raw.indexOf("#");
  if (hashIdx < 0) return null;

  const depotSpec = raw.slice(0, hashIdx);
  const pathPart = raw.slice(hashIdx + 1);

  // Parse depot specifier: "DEPOT_ID@VERSION"
  const atIdx = depotSpec.indexOf("@");
  if (atIdx <= 0 || atIdx >= depotSpec.length - 1) return null;

  const depotId = depotSpec.slice(0, atIdx);
  const version = depotSpec.slice(atIdx + 1);

  if (!depotId || !version) return null;

  // Parse index-path
  const indices = parseIndexPath(pathPart);
  if (!indices) return null;

  return {
    type: "depot",
    depotId,
    version,
    path: indices,
  };
}

// ============================================================================
// Header parsing
// ============================================================================

/**
 * Parse the X-CAS-Proof header value into a ProofMap.
 *
 * The header value is JSON: `Record<nodeHash, proofWord>`.
 *
 * @param headerValue - Raw header string, or undefined/null if absent.
 * @returns Parsed ProofMap (may be empty), or null if the header is present
 *          but contains invalid JSON or malformed proof words.
 */
export function parseProofHeader(
  headerValue: string | undefined | null,
): ProofMap | null {
  if (!headerValue || headerValue.trim().length === 0) {
    return new Map();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(headerValue);
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }

  const map = new Map<string, ProofWord>();
  const entries = Object.entries(parsed as Record<string, unknown>);

  for (const [nodeHash, rawWord] of entries) {
    if (typeof rawWord !== "string") return null;

    const word = parseProofWord(rawWord);
    if (!word) return null;

    map.set(nodeHash, word);
  }

  return map;
}
