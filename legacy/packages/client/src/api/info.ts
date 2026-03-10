/**
 * Service info API.
 */

import type { ServiceInfo } from "@casfa/protocol";
import type { FetchResult } from "../types/client.ts";
import { fetchApi } from "../utils/http.ts";

/**
 * Fetch service info from /api/info.
 */
export const fetchServiceInfo = async (baseUrl: string): Promise<FetchResult<ServiceInfo>> => {
  return fetchApi<ServiceInfo>(`${baseUrl}/api/info`);
};

/**
 * Health check.
 */
export const healthCheck = async (baseUrl: string): Promise<FetchResult<{ status: string }>> => {
  return fetchApi<{ status: string }>(`${baseUrl}/api/health`);
};
