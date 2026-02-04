/**
 * Info API functions.
 *
 * Provides access to public service configuration and feature flags.
 */

import type { ServiceInfo } from "@casfa/protocol";
import type { Fetcher, FetchResult } from "../utils/fetch.ts";

/**
 * Info API context.
 */
export type InfoApiContext = {
  fetcher: Fetcher;
};

/**
 * Get service information.
 *
 * This is a public endpoint that does not require authentication.
 * Returns service configuration including:
 * - Service name and version
 * - Storage and database types
 * - Authentication method
 * - Server limits (max node size, etc.)
 * - Feature flags
 */
export const getInfo = async (ctx: InfoApiContext): Promise<FetchResult<ServiceInfo>> => {
  return ctx.fetcher.request<ServiceInfo>("/api/info", {
    skipAuth: true,
  });
};
