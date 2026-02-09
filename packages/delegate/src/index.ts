/**
 * @casfa/delegate — Delegate entity types + pure functions.
 *
 * This package contains:
 * - Delegate data types (Delegate, CreateDelegateInput, etc.)
 * - Chain utilities (buildChain, isAncestor, chainDepth, etc.)
 * - Validation functions (permissions, depth, expiresAt, delegatedDepots)
 * - Constants (MAX_DEPTH, ROOT_DEPTH)
 *
 * It has NO runtime dependencies and NO I/O — everything is pure.
 */

// Constants
export { MAX_DEPTH, ROOT_DEPTH } from "./constants.ts";

// Types
export type {
  CreateDelegateInput,
  Delegate,
  DelegatePermissions,
  DelegateValidationError,
  DelegateValidationResult,
} from "./types.ts";

// Chain utilities
export {
  buildChain,
  buildRootChain,
  chainDepth,
  isAncestor,
  isChainValid,
  isDirectChildChain,
} from "./chain.ts";

// Validation
export {
  validateCreateDelegate,
  validateDelegatedDepots,
  validateDepth,
  validateExpiresAt,
  validatePermissions,
} from "./validation.ts";
