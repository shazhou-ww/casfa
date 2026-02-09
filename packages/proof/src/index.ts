/**
 * @casfa/proof — X-CAS-Proof header parsing, verification, and formatting.
 *
 * This package contains:
 * - Types (ProofWord, ProofMap, ProofVerificationContext, ProofResult, etc.)
 * - Parsing (parseProofHeader, parseProofWord, parseIndexPath)
 * - Verification (verifyNodeAccess, verifyMultiNodeAccess)
 * - Formatting (formatProofHeader, formatProofWord, ipath, depot)
 *
 * It has NO runtime dependencies and NO I/O — all I/O is injected via
 * ProofVerificationContext callbacks.
 */

// Types
export type {
  DepotProofWord,
  IPathProofWord,
  ProofErrorCode,
  ProofFailure,
  ProofMap,
  ProofResult,
  ProofSuccess,
  ProofVerificationContext,
  ProofWord,
  ResolvedNode,
} from "./types.ts";

// Parsing
export {
  parseIndexPath,
  parseProofHeader,
  parseProofWord,
} from "./parse.ts";

// Verification
export {
  verifyMultiNodeAccess,
  verifyNodeAccess,
} from "./verify.ts";

// Formatting
export {
  depot,
  formatDepotProofWord,
  formatIPathProofWord,
  formatProofHeader,
  formatProofWord,
  ipath,
} from "./format.ts";

// Proof-of-Possession (PoP)
export type { PopContext } from "./pop.ts";
export { computePoP, isPopString, verifyPoP } from "./pop.ts";
