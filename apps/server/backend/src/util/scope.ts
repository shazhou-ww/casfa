/**
 * Scope utilities
 *
 * Functions for validating and resolving scope in Delegate Token system.
 * Based on docs/delegate-token-refactor/04-access-control.md
 */

import type { ScopeVerificationResult } from "../types.ts";

// ============================================================================
// Types
// ============================================================================

/**
 * Result of resolving scope from CAS URIs or relative paths
 */
export type ScopeResolution =
  | {
      success: true;
      /** Single scope node hash (for single-scope tokens) */
      scopeNodeHash?: string;
      /** Scope set node ID (for multi-scope tokens) */
      scopeSetNodeId?: string;
      /** 32-byte scope hash for token generation */
      scopeHash: Uint8Array;
    }
  | {
      success: false;
      error: string;
    };

/**
 * Parsed index node structure
 */
export type ParsedIndexNode = {
  type: "index";
  children: string[];
};

// ============================================================================
// Index Path Verification
// ============================================================================

/**
 * Verify that an index path leads from scope roots to a target node
 *
 * Index path format: "rootIndex:childIndex1:childIndex2:..."
 * - First number is the index in scopeRoots array
 * - Following numbers are indices in each index node's children array
 *
 * @param nodeKey - Hash of the target node to verify
 * @param indexPath - Index path string (e.g., "0:1:2")
 * @param scopeRoots - List of scope root node hashes
 * @param getNode - Function to retrieve node data by hash
 * @returns Verification result
 */
export async function verifyIndexPath(
  nodeKey: string,
  indexPath: string,
  scopeRoots: string[],
  getNode: (hash: string) => Promise<Uint8Array | null>
): Promise<ScopeVerificationResult> {
  // Parse index path
  const indices = indexPath.split(":").map((s) => parseInt(s, 10));
  if (indices.some(isNaN)) {
    return { valid: false, reason: "Invalid index path format" };
  }

  if (indices.length === 0) {
    return { valid: false, reason: "Empty index path" };
  }

  // First index points to scope roots array
  const rootIndex = indices[0]!;
  if (rootIndex < 0 || rootIndex >= scopeRoots.length) {
    return { valid: false, reason: "Root index out of bounds" };
  }

  let currentHash = scopeRoots[rootIndex]!;

  // If only root index, check if it matches target
  if (indices.length === 1) {
    if (currentHash !== nodeKey) {
      return { valid: false, reason: "Path does not lead to requested node" };
    }
    return { valid: true, verifiedPath: indices };
  }

  // Traverse index path
  for (let i = 1; i < indices.length; i++) {
    const childIndex = indices[i]!;

    // Get current node
    const nodeData = await getNode(currentHash);
    if (!nodeData) {
      return { valid: false, reason: `Node not found: ${currentHash}` };
    }

    // Parse index node
    const parsed = parseIndexNode(nodeData);
    if (!parsed) {
      return { valid: false, reason: `Invalid index node format: ${currentHash}` };
    }

    // Check child index bounds
    if (childIndex < 0 || childIndex >= parsed.children.length) {
      return {
        valid: false,
        reason: `Child index ${childIndex} out of bounds (max: ${parsed.children.length - 1})`,
      };
    }

    // Move to child
    currentHash = parsed.children[childIndex]!;
  }

  // Verify final node matches target
  if (currentHash !== nodeKey) {
    return { valid: false, reason: "Path does not lead to requested node" };
  }

  return { valid: true, verifiedPath: indices };
}

/**
 * Parse an index node from its binary data
 *
 * Index nodes are JSON: { "type": "index", "children": ["hash1", "hash2", ...] }
 */
export function parseIndexNode(data: Uint8Array): ParsedIndexNode | null {
  try {
    const text = new TextDecoder().decode(data);
    const parsed = JSON.parse(text);

    if (parsed.type !== "index" || !Array.isArray(parsed.children)) {
      return null;
    }

    // Validate all children are strings
    if (!parsed.children.every((c: unknown) => typeof c === "string")) {
      return null;
    }

    return { type: "index", children: parsed.children };
  } catch {
    return null;
  }
}

// ============================================================================
// Relative Scope Resolution
// ============================================================================

/**
 * Resolve scope from relative index paths (for token delegation)
 *
 * Relative paths are relative to parent token's scope:
 * - "." means inherit all parent scope roots
 * - "0:1" means navigate from parent scope root 0, then child 1
 *
 * @param requestedScope - Array of relative scope paths
 * @param parentScopeRoots - Parent token's scope roots
 * @param getNode - Function to retrieve node data
 * @returns Resolved scope roots or error
 */
export async function resolveRelativeScope(
  requestedScope: string[],
  parentScopeRoots: string[],
  getNode: (hash: string) => Promise<Uint8Array | null>
): Promise<{ valid: boolean; resolvedRoots?: string[]; error?: string }> {
  const resolvedRoots: string[] = [];

  for (const scopePath of requestedScope) {
    // "." means inherit parent scope
    if (scopePath === ".") {
      resolvedRoots.push(...parentScopeRoots);
      continue;
    }

    // Parse and resolve relative path
    const indices = scopePath.split(":").map((s) => parseInt(s, 10));
    if (indices.some(isNaN)) {
      return { valid: false, error: `Invalid scope path format: ${scopePath}` };
    }

    if (indices.length === 0) {
      return { valid: false, error: "Empty scope path" };
    }

    const rootIndex = indices[0]!;
    if (rootIndex < 0 || rootIndex >= parentScopeRoots.length) {
      return { valid: false, error: `Root index out of bounds: ${rootIndex}` };
    }

    let currentHash = parentScopeRoots[rootIndex]!;

    // Navigate to final node
    for (let i = 1; i < indices.length; i++) {
      const childIndex = indices[i]!;

      const nodeData = await getNode(currentHash);
      if (!nodeData) {
        return { valid: false, error: `Node not found: ${currentHash}` };
      }

      const parsed = parseIndexNode(nodeData);
      if (!parsed) {
        return { valid: false, error: `Invalid index node: ${currentHash}` };
      }

      if (childIndex < 0 || childIndex >= parsed.children.length) {
        return { valid: false, error: `Child index out of bounds: ${childIndex}` };
      }

      currentHash = parsed.children[childIndex]!;
    }

    resolvedRoots.push(currentHash);
  }

  // Deduplicate
  const uniqueRoots = [...new Set(resolvedRoots)];

  return { valid: true, resolvedRoots: uniqueRoots };
}

// ============================================================================
// CAS URI Parsing
// ============================================================================

/**
 * Parse a CAS URI and extract the node hash
 *
 * CAS URI formats:
 * - cas://depot:DEPOT_ID - Reference to depot's current root
 * - cas://node:HASH - Direct node reference
 *
 * @param uri - CAS URI string
 * @returns Parsed URI info or null if invalid
 */
export function parseCasUri(
  uri: string
): { type: "depot"; depotId: string } | { type: "node"; hash: string } | null {
  if (!uri.startsWith("cas://")) {
    return null;
  }

  const path = uri.slice(6);

  if (path.startsWith("depot:")) {
    const depotId = path.slice(6);
    if (!depotId) return null;
    return { type: "depot", depotId };
  }

  if (path.startsWith("node:")) {
    const hash = path.slice(5);
    if (!hash) return null;
    return { type: "node", hash };
  }

  return null;
}

/**
 * Check if a string is a valid CAS URI
 */
export function isValidCasUri(uri: string): boolean {
  return parseCasUri(uri) !== null;
}
