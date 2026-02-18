/**
 * Fetch utilities for the stateful client.
 */

import type { ClientError, FetchResult } from "../types/client.ts";

// ============================================================================
// Error Handling
// ============================================================================

/**
 * Map HTTP status to error code.
 */
export const statusToErrorCode = (status: number): string => {
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
    case 429:
      return "RATE_LIMITED";
    default:
      return "UNKNOWN";
  }
};

/**
 * Create error from HTTP response.
 */
export const createErrorFromResponse = async (response: Response): Promise<ClientError> => {
  const code = statusToErrorCode(response.status);
  let message = response.statusText;
  let details: unknown = null;

  try {
    const body = (await response.json()) as Record<string, unknown>;
    // Prefer body.message (descriptive) over body.error (may be a code like "validation_error")
    if (typeof body.message === "string") {
      message = body.message;
    } else if (typeof body.error === "string") {
      // Only use body.error as message if body.message is absent
      message = body.error;
    }
    // Handle Zod validation error objects (from @hono/zod-validator default hook)
    if (body.error && typeof body.error === "object" && "issues" in (body.error as object)) {
      const issues = (
        body.error as { issues: Array<{ message: string; path?: Array<string | number> }> }
      ).issues;
      if (Array.isArray(issues) && issues.length > 0) {
        message = issues
          .map((i) => (i.path?.length ? `${i.path.join(".")}: ${i.message}` : i.message))
          .join("; ");
      }
    }
    details = body;
  } catch {
    // Response body is not JSON, use status text
  }

  return { code, message, status: response.status, details };
};

/**
 * Create a network error.
 */
export const createNetworkError = (err: unknown): ClientError => ({
  code: "NETWORK_ERROR",
  message: err instanceof Error ? err.message : "Network request failed",
  details: err,
});

// ============================================================================
// Fetch Function
// ============================================================================

export type FetchOptions = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  headers?: Record<string, string>;
  body?: unknown;
  /** Expected response type */
  responseType?: "json" | "blob" | "text" | "none";
};

/**
 * Make a fetch request with error handling.
 */
export const fetchApi = async <T>(
  url: string,
  options: FetchOptions = {}
): Promise<FetchResult<T>> => {
  const { method = "GET", headers = {}, body, responseType = "json" } = options;

  const requestHeaders: Record<string, string> = { ...headers };

  // Add content-type for JSON body
  if (body !== undefined && !requestHeaders["Content-Type"]) {
    requestHeaders["Content-Type"] = "application/json";
  }

  try {
    const response = await fetch(url, {
      method,
      headers: requestHeaders,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const error = await createErrorFromResponse(response);
      return { ok: false, error };
    }

    // Parse response based on type
    let data: T;
    switch (responseType) {
      case "json":
        data = (await response.json()) as T;
        break;
      case "blob":
        data = (await response.blob()) as T;
        break;
      case "text":
        data = (await response.text()) as T;
        break;
      case "none":
        data = undefined as T;
        break;
    }

    return { ok: true, data, status: response.status };
  } catch (err) {
    return { ok: false, error: createNetworkError(err) };
  }
};

/**
 * Make an authenticated fetch request.
 */
export const fetchWithAuth = async <T>(
  url: string,
  authHeader: string | null,
  options: FetchOptions = {}
): Promise<FetchResult<T>> => {
  const headers = { ...options.headers };

  if (authHeader) {
    headers.Authorization = authHeader;
  }

  return fetchApi<T>(url, { ...options, headers });
};
