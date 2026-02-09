/**
 * Types for X-CAS-Proof header parsing and verification.
 *
 * See ownership-and-permissions.md §5.2–5.4
 */

// ============================================================================
// ProofWord — parsed representation of a single proof entry
// ============================================================================

/**
 * Index-path proof: navigates from a scope root to the target node.
 *
 * Format in header: `"ipath#0:1:2"`
 * - `0` selects the scope root index (0 for single scope)
 * - `1:2` are child indices at each tree level
 */
export type IPathProofWord = {
  readonly type: "ipath";
  /** Index of the scope root (0 for single scope) */
  readonly scopeIndex: number;
  /** Child indices for each tree level after the scope root */
  readonly path: readonly number[];
};

/**
 * Depot-version proof: navigates from a depot's historical version root.
 *
 * Format in header: `"depot:DEPOT_ID@VERSION#0:1:2"`
 * - `DEPOT_ID` is the depot identifier
 * - `VERSION` is the historical version string
 * - `0:1:2` is the index-path from the depot version root
 */
export type DepotProofWord = {
  readonly type: "depot";
  /** Depot identifier */
  readonly depotId: string;
  /** Historical version string */
  readonly version: string;
  /** Child indices for each tree level after the version root */
  readonly path: readonly number[];
};

/**
 * A parsed proof word — either ipath or depot-version.
 */
export type ProofWord = IPathProofWord | DepotProofWord;

// ============================================================================
// ProofMap — parsed X-CAS-Proof header
// ============================================================================

/**
 * Parsed X-CAS-Proof header: maps nodeHash → ProofWord.
 */
export type ProofMap = ReadonlyMap<string, ProofWord>;

// ============================================================================
// Verification context — callbacks provided by the server
// ============================================================================

/**
 * Resolved CAS node with child hashes (hex strings).
 */
export type ResolvedNode = {
  /** Child hashes as lowercase hex strings */
  readonly children: readonly string[];
};

/**
 * Context callbacks for proof verification.
 * All I/O is injected — the proof library remains pure.
 */
export type ProofVerificationContext = {
  /**
   * Check O(1) ownership: does this delegate (or its ancestors via full-chain
   * write) own this node?
   */
  hasOwnership: (nodeHash: string, delegateId: string) => Promise<boolean>;

  /** Is this delegateId a root delegate (no scope restriction)? */
  isRootDelegate: (delegateId: string) => Promise<boolean>;

  /**
   * Get the scope root hashes for a delegate.
   * - Single scope → `[scopeNodeHash]`
   * - Multi scope → array from ScopeSetNode
   * - Root delegate → empty (root skips proof entirely)
   */
  getScopeRoots: (delegateId: string) => Promise<readonly string[]>;

  /** Resolve a CAS node hash to its parsed children. Returns null if missing. */
  resolveNode: (hash: string) => Promise<ResolvedNode | null>;

  /** Resolve a depot version to its root node hash. Returns null if invalid. */
  resolveDepotVersion: (
    depotId: string,
    version: string,
  ) => Promise<string | null>;

  /** Check if a delegate has management access to a depot. */
  hasDepotAccess: (delegateId: string, depotId: string) => Promise<boolean>;
};

// ============================================================================
// Result types
// ============================================================================

/** Proof verification success. */
export type ProofSuccess = {
  readonly ok: true;
};

/** Proof verification failure. */
export type ProofFailure = {
  readonly ok: false;
  readonly code: ProofErrorCode;
  readonly message: string;
};

/** Possible proof error codes. */
export type ProofErrorCode =
  | "MISSING_PROOF"
  | "INVALID_PROOF_FORMAT"
  | "INVALID_PROOF_WORD"
  | "SCOPE_ROOT_OUT_OF_BOUNDS"
  | "NODE_NOT_FOUND"
  | "CHILD_INDEX_OUT_OF_BOUNDS"
  | "PATH_MISMATCH"
  | "DEPOT_ACCESS_DENIED"
  | "DEPOT_VERSION_NOT_FOUND";

/** Union result type for proof verification. */
export type ProofResult = ProofSuccess | ProofFailure;
