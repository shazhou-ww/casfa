/**
 * Stateless fetch utilities for the new client architecture.
 *
 * Unlike the original fetch.ts which requires an AuthStrategy,
 * this module provides fetch functions that take auth headers directly.
 */

import { type CasfaError, createErrorFromResponse } from "../utils/errors.ts";

/**
 * Result type for fetch operations.
 */
export type FetchResult<T> =
  | { ok: true; data: T; status: number }
  | { ok: false; error: CasfaError };

/**
 * Request options for API calls.
 */
export type RequestOptions = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  headers?: Record<string, string>;
  body?: unknown;
  responseType?: "json" | "blob" | "text" | "none";
};

/**
 * Stateless fetcher configuration.
 */
export type StatelessFetcherConfig = {
  baseUrl: string;
  getAuthHeader?: () => Promise<string | null>;
  getCustomHeaders?: () => Promise<Record<string, string>>;
};

/**
 * Create a stateless fetcher.
 */
export const createStatelessFetcher = (config: StatelessFetcherConfig) => {
  const { baseUrl, getAuthHeader, getCustomHeaders } = config;

  /**
   * Make an API request.
   */
  const request = async <T>(
    path: string,
    options: RequestOptions = {}
  ): Promise<FetchResult<T>> => {
    const { method = "GET", headers = {}, body, responseType = "json" } = options;

    const url = `${baseUrl}${path}`;
    const requestHeaders: Record<string, string> = { ...headers };

    // Add auth headers if available
    if (getAuthHeader) {
      const authHeader = await getAuthHeader();
      if (authHeader) {
        requestHeaders.Authorization = authHeader;
      }
    }

    // Add custom headers if available
    if (getCustomHeaders) {
      const customHeaders = await getCustomHeaders();
      Object.assign(requestHeaders, customHeaders);
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
   * Upload binary data.
   */
  const uploadBinary = async (
    path: string,
    data: Uint8Array,
    options: { headers?: Record<string, string>; contentType?: string } = {}
  ): Promise<FetchResult<unknown>> => {
    const url = `${baseUrl}${path}`;
    const requestHeaders: Record<string, string> = {
      "Content-Type": options.contentType ?? "application/octet-stream",
      ...options.headers,
    };

    // Add auth headers
    if (getAuthHeader) {
      const authHeader = await getAuthHeader();
      if (authHeader) {
        requestHeaders.Authorization = authHeader;
      }
    }

    if (getCustomHeaders) {
      const customHeaders = await getCustomHeaders();
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
    if (getAuthHeader) {
      const authHeader = await getAuthHeader();
      if (authHeader) {
        requestHeaders.Authorization = authHeader;
      }
    }

    if (getCustomHeaders) {
      const customHeaders = await getCustomHeaders();
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

export type StatelessFetcher = ReturnType<typeof createStatelessFetcher>;
