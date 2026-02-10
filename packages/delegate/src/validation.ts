/**
 * Delegate creation validation — pure functions.
 *
 * These validate that a child delegate does NOT escalate beyond
 * what the parent delegate is allowed.
 *
 * Rules (from design doc §2.3):
 *  - canUpload   ≤ parent.canUpload
 *  - canManageDepot ≤ parent.canManageDepot
 *  - depth       = parent.depth + 1  &&  ≤ MAX_DEPTH
 *  - expiresAt   ≤ parent.expiresAt  (if parent has one)
 *  - delegatedDepots ⊆ parent's manageable depots
 */

import { MAX_DEPTH } from "./constants.ts";
import type {
  CreateDelegateInput,
  DelegatePermissions,
  DelegateValidationResult,
} from "./types.ts";

// ============================================================================
// Permission Validation
// ============================================================================

/**
 * Validate that child permissions do not exceed parent permissions.
 * Boolean permissions use ≤ comparison (true > false).
 *
 * @param parent - Parent delegate's permission fields.
 * @param child  - Requested child permissions from CreateDelegateInput.
 * @returns Validation result.
 */
export function validatePermissions(
  parent: DelegatePermissions,
  child: Pick<CreateDelegateInput, "canUpload" | "canManageDepot">
): DelegateValidationResult {
  if (child.canUpload && !parent.canUpload) {
    return {
      valid: false,
      error: "PERMISSION_ESCALATION",
      message: "Child canUpload exceeds parent (parent=false, child=true)",
    };
  }
  if (child.canManageDepot && !parent.canManageDepot) {
    return {
      valid: false,
      error: "PERMISSION_ESCALATION",
      message: "Child canManageDepot exceeds parent (parent=false, child=true)",
    };
  }
  return { valid: true };
}

// ============================================================================
// Depth Validation
// ============================================================================

/**
 * Validate that the child's depth does not exceed MAX_DEPTH.
 * Child depth = parent depth + 1.
 *
 * @param parentDepth - The parent delegate's depth (0-based).
 * @returns Validation result.
 */
export function validateDepth(parentDepth: number): DelegateValidationResult {
  const childDepth = parentDepth + 1;
  if (childDepth > MAX_DEPTH) {
    return {
      valid: false,
      error: "DEPTH_EXCEEDED",
      message: `Child depth ${childDepth} exceeds MAX_DEPTH ${MAX_DEPTH}`,
    };
  }
  return { valid: true };
}

// ============================================================================
// ExpiresAt Validation
// ============================================================================

/**
 * Validate that child expiresAt does not exceed parent's remaining lifetime.
 *
 * Rules:
 *  - If parent has no expiresAt → child can set any expiresAt (or none)
 *  - If parent has expiresAt and child has none → error (child would outlive parent)
 *  - If parent has expiresAt and child has expiresAt → child must be ≤ parent
 *
 * @param parentExpiresAt - Parent's expiresAt (epoch ms), undefined = no expiration.
 * @param childExpiresAt  - Requested child expiresAt (epoch ms), undefined = no expiration.
 * @returns Validation result.
 */
export function validateExpiresAt(
  parentExpiresAt: number | undefined,
  childExpiresAt: number | undefined
): DelegateValidationResult {
  // If parent has no expiration, child can do whatever it wants
  if (parentExpiresAt === undefined) {
    return { valid: true };
  }

  // Parent has expiration — child must also have one
  if (childExpiresAt === undefined) {
    return {
      valid: false,
      error: "EXPIRES_AFTER_PARENT",
      message: "Child has no expiresAt but parent expires — child would outlive parent",
    };
  }

  // Both have expiresAt — child must not outlive parent
  if (childExpiresAt > parentExpiresAt) {
    return {
      valid: false,
      error: "EXPIRES_AFTER_PARENT",
      message: `Child expiresAt (${childExpiresAt}) exceeds parent expiresAt (${parentExpiresAt})`,
    };
  }

  return { valid: true };
}

// ============================================================================
// DelegatedDepots Validation
// ============================================================================

/**
 * Validate that requested delegatedDepots are within the parent's manageable range.
 *
 * Per design doc §2.3: delegatedDepots 中的每个 Depot ID 必须在父 delegate 的
 * 可管理范围内。否则拒绝创建。
 *
 * Note: The full manageable range includes parent-self-created, parent-descendant-created,
 * and parent's own delegatedDepots. The caller is responsible for computing this set
 * and passing it as `parentManageableDepots`.
 *
 * @param parentManageableDepots - Set of depot IDs the parent can manage.
 * @param requestedDepots - Depot IDs the child wants delegated.
 * @returns Validation result.
 */
export function validateDelegatedDepots(
  parentManageableDepots: Set<string>,
  requestedDepots: string[] | undefined
): DelegateValidationResult {
  if (!requestedDepots || requestedDepots.length === 0) {
    return { valid: true };
  }

  for (const depotId of requestedDepots) {
    if (!parentManageableDepots.has(depotId)) {
      return {
        valid: false,
        error: "DELEGATED_DEPOTS_ESCALATION",
        message: `Depot "${depotId}" is not in parent's manageable range`,
      };
    }
  }

  return { valid: true };
}

// ============================================================================
// Composite Validation
// ============================================================================

/**
 * Run all creation-time validations for a new child delegate.
 * Returns the first error found, or { valid: true } if all pass.
 *
 * @param parent - Parent delegate's permissions.
 * @param input  - CreateDelegateInput for the new child.
 * @param parentManageableDepots - Set of depot IDs the parent can manage.
 * @returns Validation result.
 */
export function validateCreateDelegate(
  parent: DelegatePermissions,
  input: CreateDelegateInput,
  parentManageableDepots: Set<string>
): DelegateValidationResult {
  // 1. Depth
  const depthResult = validateDepth(parent.depth);
  if (!depthResult.valid) return depthResult;

  // 2. Permissions
  const permResult = validatePermissions(parent, input);
  if (!permResult.valid) return permResult;

  // 3. ExpiresAt
  const expiresResult = validateExpiresAt(parent.expiresAt, input.expiresAt);
  if (!expiresResult.valid) return expiresResult;

  // 4. DelegatedDepots
  const depotsResult = validateDelegatedDepots(parentManageableDepots, input.delegatedDepots);
  if (!depotsResult.valid) return depotsResult;

  return { valid: true };
}
