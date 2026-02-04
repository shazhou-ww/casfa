/**
 * Admin API functions.
 */

import type { PaginatedResponse, UserListItem, UserRole } from "../types/api.ts";
import type { Fetcher, FetchResult } from "../utils/fetch.ts";

/**
 * Admin API context.
 */
export type AdminApiContext = {
  fetcher: Fetcher;
};

/**
 * List all users (admin only).
 */
export type ListUsersParams = {
  cursor?: string;
  limit?: number;
  role?: UserRole;
};

export const listUsers = async (
  ctx: AdminApiContext,
  params: ListUsersParams = {}
): Promise<FetchResult<PaginatedResponse<UserListItem>>> => {
  const query = new URLSearchParams();
  if (params.cursor) query.set("cursor", params.cursor);
  if (params.limit) query.set("limit", params.limit.toString());
  if (params.role) query.set("role", params.role);

  const queryStr = query.toString();
  const path = `/api/admin/users${queryStr ? `?${queryStr}` : ""}`;

  return ctx.fetcher.request<PaginatedResponse<UserListItem>>(path);
};

/**
 * Update user role (admin only).
 */
export type UpdateUserRoleParams = {
  userId: string;
  role: UserRole;
};

export const updateUserRole = async (
  ctx: AdminApiContext,
  params: UpdateUserRoleParams
): Promise<FetchResult<UserListItem>> => {
  return ctx.fetcher.request<UserListItem>(`/api/admin/users/${params.userId}`, {
    method: "PATCH",
    body: { role: params.role },
  });
};
