/**
 * Fetch wrapper with authentication and error handling.
 */

import type { AuthStrategy } from "../types/auth.ts";
import { type CasfaError, createErrorFromResponse } from "./errors.ts";

/**
 * Request configuration for fetch wrapper.
 */
export type FetchConfig = {
  baseUrl: string;
  auth: AuthStrategy;
};

/**
 * Request options extending standard fetch options.
 */
export type RequestOptions = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  headers?: Record<string, string>;
  body?: unknown;
  /** Skip authentication for public endpoints */
  skipAuth?: boolean;
  /** Expected response type */
  responseType?: "json" | "blob" | "text" | "none";
};

/**
 * Result type for fetch operations.
 */
export type FetchResult<T> =
  | { ok: true; data: T; status: number }
  | { ok: false; error: CasfaError };

/**
 * Create a configured fetch function.
 */
export const createFetch = (config: FetchConfig) => {
  const { baseUrl, auth } = config;

  /**
   * Make an authenticated request.
   */
  const request = async <T>(
    path: string,
    options: RequestOptions = {}
  ): Promise<FetchResult<T>> => {
    const { method = "GET", headers = {}, body, skipAuth = false, responseType = "json" } = options;

    const url = `${baseUrl}${path}`;
    const requestHeaders: Record<string, string> = {
      ...headers,
    };

    // Add auth headers if not skipped
    if (!skipAuth) {
      const authHeader = await auth.getAuthHeader();
      if (authHeader) {
        requestHeaders.Authorization = authHeader;
      }

      // Add custom headers for P256 auth
      const customHeaders = await auth.getCustomHeaders?.();
      if (customHeaders) {
        Object.assign(requestHeaders, customHeaders);
      }
    }

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

      // Handle 401 with auth retry
      if (response.status === 401 && !skipAuth) {
        const retried = await auth.handleUnauthorized();
        if (retried) {
          // Retry the request with refreshed auth
          return request(path, options);
        }
      }

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
      return {
        ok: false,
        error: {
          code: "NETWORK_ERROR",
          message: err instanceof Error ? err.message : "Network error",
          details: err,
        },
      };
    }
  };

  /**
   * Make a binary upload request.
   */
  const uploadBinary = async (
    path: string,
    data: Uint8Array,
    options: {
      headers?: Record<string, string>;
      contentType?: string;
    } = {}
  ): Promise<FetchResult<unknown>> => {
    const url = `${baseUrl}${path}`;
    const requestHeaders: Record<string, string> = {
      "Content-Type": options.contentType ?? "application/octet-stream",
      ...options.headers,
    };

    // Add auth headers
    const authHeader = await auth.getAuthHeader();
    if (authHeader) {
      requestHeaders.Authorization = authHeader;
    }

    const customHeaders = await auth.getCustomHeaders?.();
    if (customHeaders) {
      Object.assign(requestHeaders, customHeaders);
    }

    try {
      const response = await fetch(url, {
        method: "PUT",
        headers: requestHeaders,
        body: data,
      });

      if (!response.ok) {
        const error = await createErrorFromResponse(response);
        return { ok: false, error };
      }

      const responseData = await response.json();
      return { ok: true, data: responseData, status: response.status };
    } catch (err) {
      return {
        ok: false,
        error: {
          code: "NETWORK_ERROR",
          message: err instanceof Error ? err.message : "Network error",
          details: err,
        },
      };
    }
  };

  /**
   * Download binary data.
   */
  const downloadBinary = async (path: string): Promise<FetchResult<Uint8Array>> => {
    const url = `${baseUrl}${path}`;
    const requestHeaders: Record<string, string> = {};

    // Add auth headers
    const authHeader = await auth.getAuthHeader();
    if (authHeader) {
      requestHeaders.Authorization = authHeader;
    }

    const customHeaders = await auth.getCustomHeaders?.();
    if (customHeaders) {
      Object.assign(requestHeaders, customHeaders);
    }

    try {
      const response = await fetch(url, {
        method: "GET",
        headers: requestHeaders,
      });

      if (!response.ok) {
        const error = await createErrorFromResponse(response);
        return { ok: false, error };
      }

      const arrayBuffer = await response.arrayBuffer();
      return {
        ok: true,
        data: new Uint8Array(arrayBuffer),
        status: response.status,
      };
    } catch (err) {
      return {
        ok: false,
        error: {
          code: "NETWORK_ERROR",
          message: err instanceof Error ? err.message : "Network error",
          details: err,
        },
      };
    }
  };

  return { request, uploadBinary, downloadBinary };
};

export type Fetcher = ReturnType<typeof createFetch>;
