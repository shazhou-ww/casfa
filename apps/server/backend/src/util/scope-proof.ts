/**
 * Scope proof validation utility
 *
 * Validates that a given node is reachable from a Token's scope root
 * via an index-path (proof). This is the mechanism for a Token to
 * reference nodes it doesn't own but that are within its scope tree.
 *
 * See docs/put-node-children-auth.md §4.3–4.4
 */

import { decodeNode } from "@casfa/core";
import type { StorageProvider } from "@casfa/storage-core";
import type { ScopeSetNodesDb } from "../db/scope-set-nodes.ts";
import type { AccessTokenAuthContext } from "../types.ts";

// ============================================================================
// Types
// ============================================================================

export type ScopeProofDeps = {
  storage: StorageProvider;
  scopeSetNodesDb: ScopeSetNodesDb;
};

// ============================================================================
// Helpers
// ============================================================================

/** Convert Uint8Array hash → lowercase hex string */
const hashToHex = (hash: Uint8Array): string =>
  Array.from(hash)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

// ============================================================================
// Public API
// ============================================================================

/**
 * Parse a proof string ("0:1:2") into an array of non-negative integers.
 * Returns null if the proof is malformed.
 */
export function parseProof(proof: string): number[] | null {
  if (!proof || proof.trim().length === 0) return null;

  const parts = proof.split(":");
  const indices: number[] = [];

  for (const part of parts) {
    const n = Number(part);
    if (!Number.isInteger(n) || n < 0) return null;
    indices.push(n);
  }

  return indices.length > 0 ? indices : null;
}

/**
 * Validate that a proof (index-path) leads from the Token's scope root
 * to the target node.
 *
 * Token scope can be:
 * 1. Single scope (scopeNodeHash) — a direct CAS node hash
 * 2. Multi scope (scopeSetNodeId) — a DB ScopeSetNode containing multiple roots
 *
 * @param proof - Index-path string, e.g. "0:1:2"
 * @param targetNodeHex - The hex hash of the node to verify
 * @param auth - The Access Token auth context
 * @param deps - Storage and ScopeSetNodesDb
 * @returns true if the proof is valid (target is reachable from scope)
 */
export async function validateProofAgainstScope(
  proof: string,
  targetNodeHex: string,
  auth: AccessTokenAuthContext,
  deps: ScopeProofDeps
): Promise<boolean> {
  // 1. Parse proof into index array
  const indices = parseProof(proof);
  if (!indices) return false;

  // 2. Determine the starting node based on scope type
  let currentHash: string;
  let pathStart: number;

  const tokenRecord = auth.tokenRecord;

  if (tokenRecord.scopeNodeHash) {
    // Single scope: scopeNodeHash is a CAS node hash.
    // The proof traverses from this node's children.
    currentHash = tokenRecord.scopeNodeHash;
    pathStart = 0;
  } else if (tokenRecord.scopeSetNodeId) {
    // Multi scope: first index selects which scope root from the set-node
    const setNode = await deps.scopeSetNodesDb.get(tokenRecord.scopeSetNodeId);
    if (!setNode) return false;

    if (indices.length === 0) return false;
    const rootIndex = indices[0]!;
    if (rootIndex >= setNode.children.length) return false;

    currentHash = setNode.children[rootIndex]!;
    pathStart = 1;
  } else {
    // No scope (write-only Token) — proof not supported
    return false;
  }

  // 3. Traverse the CAS tree by index-path
  for (let i = pathStart; i < indices.length; i++) {
    const nodeData = await deps.storage.get(currentHash);
    if (!nodeData) return false;

    let node: ReturnType<typeof decodeNode>;
    try {
      node = decodeNode(nodeData);
    } catch {
      return false;
    }

    const idx = indices[i]!;
    if (!node.children || idx >= node.children.length) return false;

    currentHash = hashToHex(node.children[idx]!);
  }

  // 4. Check if the final node matches the target
  return currentHash === targetNodeHex;
}

/**
 * Parse the X-CAS-Child-Proofs header into a Map of childKey → proof.
 *
 * Header format: "child1_hex=0:1:2,child2_hex=0:3"
 *
 * @param headerValue - The raw header string
 * @returns Map from child hex key to proof string
 */
export function parseChildProofsHeader(headerValue: string | undefined): Map<string, string> {
  const proofs = new Map<string, string>();
  if (!headerValue) return proofs;

  const pairs = headerValue.split(",");
  for (const pair of pairs) {
    const trimmed = pair.trim();
    if (!trimmed) continue;

    const eqIdx = trimmed.indexOf("=");
    if (eqIdx <= 0) continue;

    const childKey = trimmed.slice(0, eqIdx).trim();
    const proof = trimmed.slice(eqIdx + 1).trim();
    if (childKey && proof) {
      proofs.set(childKey, proof);
    }
  }

  return proofs;
}
