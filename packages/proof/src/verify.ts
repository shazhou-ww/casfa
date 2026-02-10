/**
 * Proof verification — determines whether a delegate can access a given node.
 *
 * Verification flow (§5.4):
 *   1. Ownership check — O(1) GetItem → pass
 *   2. Root delegate — skip proof entirely
 *   3. Proof walk — parse proofWord, walk CAS DAG, compare final hash
 *
 * All I/O is injected via ProofVerificationContext (pure function pattern).
 *
 * See ownership-and-permissions.md §5.2–5.5
 */

import type {
  DepotProofWord,
  IPathProofWord,
  ProofFailure,
  ProofMap,
  ProofResult,
  ProofSuccess,
  ProofVerificationContext,
} from "./types.ts";

// ============================================================================
// Helpers
// ============================================================================

const ok: ProofSuccess = { ok: true } as const;

function fail(code: ProofFailure["code"], message: string): ProofFailure {
  return { ok: false, code, message };
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Verify that a delegate can access a specific node.
 *
 * The function checks in order:
 *   1. **Ownership** — O(1) lookup via full-chain ownership records
 *   2. **Root delegate** — root delegates have unrestricted access
 *   3. **Proof** — walk the CAS DAG from scope root or depot version root
 *
 * @param nodeHash   - Hex hash of the node to verify access to
 * @param delegateId - ID of the delegate requesting access
 * @param proofMap   - Parsed X-CAS-Proof header (may be empty)
 * @param ctx        - I/O callbacks
 */
export async function verifyNodeAccess(
  nodeHash: string,
  delegateId: string,
  proofMap: ProofMap,
  ctx: ProofVerificationContext
): Promise<ProofResult> {
  // 1. Ownership fast-path (O(1) GetItem)
  if (await ctx.hasOwnership(nodeHash, delegateId)) {
    return ok;
  }

  // 2. Root delegate — unrestricted
  if (await ctx.isRootDelegate(delegateId)) {
    return ok;
  }

  // 3. Proof verification
  const proofWord = proofMap.get(nodeHash);
  if (!proofWord) {
    return fail("MISSING_PROOF", `No proof provided for node ${nodeHash}`);
  }

  if (proofWord.type === "ipath") {
    return verifyIPathProof(nodeHash, delegateId, proofWord, ctx);
  }

  // proofWord.type === "depot"
  return verifyDepotProof(nodeHash, delegateId, proofWord, ctx);
}

/**
 * Verify access for multiple nodes at once.
 * Short-circuits on first failure.
 *
 * @param nodeHashes  - Array of hex hashes to verify
 * @param delegateId  - ID of the delegate
 * @param proofMap    - Parsed X-CAS-Proof header
 * @param ctx         - I/O callbacks
 */
export async function verifyMultiNodeAccess(
  nodeHashes: readonly string[],
  delegateId: string,
  proofMap: ProofMap,
  ctx: ProofVerificationContext
): Promise<ProofResult> {
  for (const hash of nodeHashes) {
    const result = await verifyNodeAccess(hash, delegateId, proofMap, ctx);
    if (!result.ok) return result;
  }
  return ok;
}

// ============================================================================
// ipath verification
// ============================================================================

/**
 * Verify an ipath proof: walk from delegate scope root to target node.
 */
async function verifyIPathProof(
  nodeHash: string,
  delegateId: string,
  proof: IPathProofWord,
  ctx: ProofVerificationContext
): Promise<ProofResult> {
  // Resolve scope roots for this delegate
  const scopeRoots = await ctx.getScopeRoots(delegateId);

  if (proof.scopeIndex < 0 || proof.scopeIndex >= scopeRoots.length) {
    return fail(
      "SCOPE_ROOT_OUT_OF_BOUNDS",
      `Scope root index ${proof.scopeIndex} out of bounds (have ${scopeRoots.length} roots)`
    );
  }

  const startHash = scopeRoots[proof.scopeIndex]!;
  return walkPath(nodeHash, startHash, proof.path, ctx);
}

// ============================================================================
// depot-version verification
// ============================================================================

/**
 * Verify a depot-version proof: check depot access, resolve version root,
 * then walk CAS DAG.
 */
async function verifyDepotProof(
  nodeHash: string,
  delegateId: string,
  proof: DepotProofWord,
  ctx: ProofVerificationContext
): Promise<ProofResult> {
  // 1. Check depot access
  if (!(await ctx.hasDepotAccess(delegateId, proof.depotId))) {
    return fail(
      "DEPOT_ACCESS_DENIED",
      `Delegate ${delegateId} does not have access to depot ${proof.depotId}`
    );
  }

  // 2. Resolve depot version root hash
  const rootHash = await ctx.resolveDepotVersion(proof.depotId, proof.version);
  if (!rootHash) {
    return fail(
      "DEPOT_VERSION_NOT_FOUND",
      `Depot ${proof.depotId} version ${proof.version} not found`
    );
  }

  return walkPath(nodeHash, rootHash, proof.path, ctx);
}

// ============================================================================
// Shared DAG walker
// ============================================================================

/**
 * Walk the CAS DAG from a starting node along child indices,
 * verifying that the final node matches the target hash.
 *
 * @param targetHash - Expected final node hash
 * @param startHash  - Hash of the starting node
 * @param path       - Child indices to follow at each level
 * @param ctx        - Provides resolveNode
 */
async function walkPath(
  targetHash: string,
  startHash: string,
  path: readonly number[],
  ctx: Pick<ProofVerificationContext, "resolveNode">
): Promise<ProofResult> {
  let currentHash = startHash;

  // If path is empty, the start node itself must be the target
  if (path.length === 0) {
    return currentHash === targetHash
      ? ok
      : fail("PATH_MISMATCH", `Scope root ${currentHash} ≠ target ${targetHash}`);
  }

  for (let i = 0; i < path.length; i++) {
    const node = await ctx.resolveNode(currentHash);
    if (!node) {
      return fail(
        "NODE_NOT_FOUND",
        `Node ${currentHash} not found while walking proof at depth ${i}`
      );
    }

    const childIdx = path[i]!;
    if (childIdx < 0 || childIdx >= node.children.length) {
      return fail(
        "CHILD_INDEX_OUT_OF_BOUNDS",
        `Child index ${childIdx} out of bounds (node ${currentHash} has ${node.children.length} children) at depth ${i}`
      );
    }

    currentHash = node.children[childIdx]!;
  }

  // Final hash must match target
  return currentHash === targetHash
    ? ok
    : fail("PATH_MISMATCH", `Proof path ended at ${currentHash}, expected ${targetHash}`);
}
