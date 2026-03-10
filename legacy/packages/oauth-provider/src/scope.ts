/**
 * Scope Validation & Mapping
 *
 * Validate requested OAuth scopes against supported scopes,
 * and map scopes to business-specific permission objects.
 */

import type { Result } from "./types.ts";

// ============================================================================
// Scope Validation
// ============================================================================

/**
 * Validate that all requested scopes are supported.
 *
 * Returns the deduplicated, validated scope list, or an `invalid_scope` error
 * listing the unsupported scopes.
 *
 * @param requestedScopes - Scopes requested by the client
 * @param supportedScopes - Scopes supported by the authorization server
 * @returns Validated scope list or error
 *
 * @example
 * ```ts
 * const result = validateScopes(
 *   ["cas:read", "cas:write", "bad:scope"],
 *   ["cas:read", "cas:write", "depot:manage"]
 * );
 * // result = { ok: false, error: { code: "invalid_scope", message: "Unknown scopes: bad:scope", ... } }
 * ```
 */
export function validateScopes(
  requestedScopes: string[],
  supportedScopes: string[]
): Result<string[]> {
  const supported = new Set(supportedScopes);
  const invalid = requestedScopes.filter((s) => !supported.has(s));

  if (invalid.length > 0) {
    return {
      ok: false,
      error: {
        code: "invalid_scope",
        message: `Unknown scopes: ${invalid.join(", ")}`,
        statusCode: 400,
      },
    };
  }

  // Deduplicate
  const unique = [...new Set(requestedScopes)];
  return { ok: true, value: unique };
}

// ============================================================================
// Scope → Permission Mapping
// ============================================================================

/**
 * Map OAuth scopes to a business-specific permissions object.
 *
 * Starts with `defaults`, then merges in partial permission objects
 * for each matching scope from `mapping`. Scopes not in the mapping
 * are silently ignored (they may represent read-only access, etc.).
 *
 * @typeParam TPermissions - Shape of the business permissions object
 * @param scopes - Validated scope list
 * @param mapping - Scope → partial permissions mapping
 * @param defaults - Base permissions (before any scopes are applied)
 * @returns Merged permissions object
 *
 * @example
 * ```ts
 * type Perms = { canUpload: boolean; canManageDepot: boolean };
 *
 * const perms = mapScopes<Perms>(
 *   ["cas:read", "cas:write"],
 *   { "cas:write": { canUpload: true }, "depot:manage": { canManageDepot: true } },
 *   { canUpload: false, canManageDepot: false }
 * );
 * // perms = { canUpload: true, canManageDepot: false }
 * ```
 */
export function mapScopes<TPermissions extends Record<string, unknown>>(
  scopes: string[],
  mapping: Record<string, Partial<TPermissions>>,
  defaults: TPermissions
): TPermissions {
  let result = { ...defaults };
  for (const scope of scopes) {
    const partial = mapping[scope];
    if (partial) {
      result = { ...result, ...partial };
    }
  }
  return result;
}
