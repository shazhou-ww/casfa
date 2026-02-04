/**
 * Realm API functions.
 */

import type { RealmInfo, RealmUsage } from "../types/api.ts";
import type { Fetcher, FetchResult } from "../utils/fetch.ts";

/**
 * Realm API context.
 */
export type RealmApiContext = {
  fetcher: Fetcher;
  realmId: string;
};

/**
 * Get realm information.
 */
export const getRealmInfo = async (ctx: RealmApiContext): Promise<FetchResult<RealmInfo>> => {
  return ctx.fetcher.request<RealmInfo>(`/api/realm/${ctx.realmId}`);
};

/**
 * Get realm usage statistics.
 */
export const getRealmUsage = async (ctx: RealmApiContext): Promise<FetchResult<RealmUsage>> => {
  return ctx.fetcher.request<RealmUsage>(`/api/realm/${ctx.realmId}/usage`);
};
