/**
 * Error types for casfa-client-v2
 */

/**
 * Base error for all CASFA client errors.
 */
export type CasfaErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "VALIDATION_ERROR"
  | "NETWORK_ERROR"
  | "PERMISSION_DENIED"
  | "AUTH_REQUIRED"
  | "TOKEN_EXPIRED"
  | "TICKET_EXPIRED"
  | "TICKET_REVOKED"
  | "QUOTA_EXCEEDED"
  | "UNKNOWN";

export type CasfaError = {
  code: CasfaErrorCode;
  message: string;
  status?: number;
  details?: unknown;
};

/**
 * Create a CasfaError object.
 */
export const createError = (
  code: CasfaErrorCode,
  message: string,
  status?: number,
  details?: unknown
): CasfaError => ({
  code,
  message,
  status,
  details,
});

/**
 * Check if an error is a CasfaError.
 */
export const isCasfaError = (error: unknown): error is CasfaError => {
  return typeof error === "object" && error !== null && "code" in error && "message" in error;
};

/**
 * Map HTTP status to error code.
 */
export const statusToErrorCode = (status: number): CasfaErrorCode => {
  switch (status) {
    case 401:
      return "UNAUTHORIZED";
    case 403:
      return "FORBIDDEN";
    case 404:
      return "NOT_FOUND";
    case 409:
      return "CONFLICT";
    case 400:
    case 422:
      return "VALIDATION_ERROR";
    default:
      return "UNKNOWN";
  }
};

/**
 * Create error from HTTP response.
 */
export const createErrorFromResponse = async (response: Response): Promise<CasfaError> => {
  const code = statusToErrorCode(response.status);
  let message = response.statusText;
  let details: unknown;

  try {
    const body = (await response.json()) as Record<string, unknown>;
    if (typeof body.message === "string") {
      message = body.message;
    }
    if (typeof body.error === "string") {
      message = body.error;
    }
    details = body;
  } catch {
    // Response body is not JSON, use status text
  }

  return createError(code, message, response.status, details);
};

/**
 * Permission denied error for unauthorized API access.
 */
export const createPermissionError = (apiName: string, requiredAuth: string[]): CasfaError =>
  createError(
    "PERMISSION_DENIED",
    `API '${apiName}' requires one of: ${requiredAuth.join(", ")}`,
    403
  );
