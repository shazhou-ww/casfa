/**
 * Error codes and types for CASFA API
 *
 * These error codes are used in API responses to provide
 * machine-readable error information.
 */

import { z } from "zod";

// ============================================================================
// Token & Permission Error Codes
// ============================================================================

/** Access Token is required but a Delegate Token was provided */
export const ACCESS_TOKEN_REQUIRED = "ACCESS_TOKEN_REQUIRED";

/** Delegate Token is required but an Access Token was provided */
export const DELEGATE_TOKEN_REQUIRED = "DELEGATE_TOKEN_REQUIRED";

/** Token's realm does not match the requested realm */
export const REALM_MISMATCH = "REALM_MISMATCH";

/** Token does not have upload permission */
export const UPLOAD_NOT_ALLOWED = "UPLOAD_NOT_ALLOWED";

/** Token does not have depot management permission */
export const DEPOT_MANAGEMENT_NOT_ALLOWED = "DEPOT_MANAGEMENT_NOT_ALLOWED";

/** Node path does not match token's scope restriction */
export const SCOPE_MISMATCH = "SCOPE_MISMATCH";

// ============================================================================
// Token Lifecycle Error Codes
// ============================================================================

/** Token has been revoked */
export const TOKEN_REVOKED = "TOKEN_REVOKED";

/** Token has expired */
export const TOKEN_EXPIRED = "TOKEN_EXPIRED";

/** Token not found */
export const TOKEN_NOT_FOUND = "TOKEN_NOT_FOUND";

/** Invalid token format */
export const TOKEN_INVALID = "TOKEN_INVALID";

/** Maximum token delegation depth exceeded */
export const MAX_DEPTH_EXCEEDED = "MAX_DEPTH_EXCEEDED";

// ============================================================================
// Authorization Request Error Codes
// ============================================================================

/** Authorization request not found */
export const REQUEST_NOT_FOUND = "REQUEST_NOT_FOUND";

/** Authorization request has expired */
export const REQUEST_EXPIRED = "REQUEST_EXPIRED";

/** Authorization request is not in pending status */
export const REQUEST_NOT_PENDING = "REQUEST_NOT_PENDING";

/** Authorization request was denied */
export const REQUEST_DENIED = "REQUEST_DENIED";

// ============================================================================
// Resource Error Codes
// ============================================================================

/** Access Token is already bound to another entity */
export const TOKEN_ALREADY_BOUND = "TOKEN_ALREADY_BOUND";

/** Bound token is invalid (not found, not access type, or revoked) */
export const INVALID_BOUND_TOKEN = "INVALID_BOUND_TOKEN";

/** Depot not found */
export const DEPOT_NOT_FOUND = "DEPOT_NOT_FOUND";

/** Node not found */
export const NODE_NOT_FOUND = "NODE_NOT_FOUND";

/** Realm not found */
export const REALM_NOT_FOUND = "REALM_NOT_FOUND";

// ============================================================================
// Validation Error Codes
// ============================================================================

/** Request body validation failed */
export const VALIDATION_ERROR = "VALIDATION_ERROR";

/** Invalid node key format */
export const INVALID_NODE_KEY = "INVALID_NODE_KEY";

/** Invalid ID format */
export const INVALID_ID_FORMAT = "INVALID_ID_FORMAT";

// ============================================================================
// General Error Codes
// ============================================================================

/** Authentication required */
export const UNAUTHORIZED = "UNAUTHORIZED";

/** Permission denied */
export const FORBIDDEN = "FORBIDDEN";

/** Rate limit exceeded */
export const RATE_LIMIT_EXCEEDED = "RATE_LIMIT_EXCEEDED";

/** Internal server error */
export const INTERNAL_ERROR = "INTERNAL_ERROR";

// ============================================================================
// Error Response Schema
// ============================================================================

/**
 * Standard error response schema
 */
export const ErrorResponseSchema = z.object({
  /** Machine-readable error code */
  error: z.string(),
  /** Human-readable error message */
  message: z.string(),
  /** Additional error details (optional) */
  details: z.record(z.unknown()).optional(),
});

export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

/**
 * All error codes as a union type
 */
export const ErrorCodeSchema = z.enum([
  // Token & Permission
  ACCESS_TOKEN_REQUIRED,
  DELEGATE_TOKEN_REQUIRED,
  REALM_MISMATCH,
  UPLOAD_NOT_ALLOWED,
  DEPOT_MANAGEMENT_NOT_ALLOWED,
  SCOPE_MISMATCH,
  // Token Lifecycle
  TOKEN_REVOKED,
  TOKEN_EXPIRED,
  TOKEN_NOT_FOUND,
  TOKEN_INVALID,
  MAX_DEPTH_EXCEEDED,
  // Authorization Request
  REQUEST_NOT_FOUND,
  REQUEST_EXPIRED,
  REQUEST_NOT_PENDING,
  REQUEST_DENIED,
  // Resources
  TOKEN_ALREADY_BOUND,
  INVALID_BOUND_TOKEN,
  DEPOT_NOT_FOUND,
  NODE_NOT_FOUND,
  REALM_NOT_FOUND,
  // Validation
  VALIDATION_ERROR,
  INVALID_NODE_KEY,
  INVALID_ID_FORMAT,
  // General
  UNAUTHORIZED,
  FORBIDDEN,
  RATE_LIMIT_EXCEEDED,
  INTERNAL_ERROR,
]);

export type ErrorCode = z.infer<typeof ErrorCodeSchema>;
