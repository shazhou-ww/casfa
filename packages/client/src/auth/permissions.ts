/**
 * Permission checking for API access based on auth type.
 */

import type { AuthState, AuthType } from "../types/auth.ts";
import { type CasfaError, createPermissionError } from "../utils/errors.ts";

/**
 * API name identifier for permission checking.
 */
export type ApiName =
  // OAuth - public endpoints
  | "oauth.getConfig"
  | "oauth.exchangeCode"
  | "oauth.login"
  | "oauth.refresh"
  // OAuth - authenticated
  | "oauth.getMe"
  // AWP Client - public
  | "auth.initClient"
  | "auth.pollClient"
  // AWP Client - user only
  | "auth.completeClient"
  | "auth.listClients"
  | "auth.revokeClient"
  // Agent Token - user only
  | "auth.createAgentToken"
  | "auth.listAgentTokens"
  | "auth.revokeAgentToken"
  // Admin - admin user only
  | "admin.listUsers"
  | "admin.updateUserRole"
  // MCP - user or agent token
  | "mcp.call"
  // Realm - user, agent, or ticket
  | "realm.getInfo"
  | "realm.getUsage"
  // Tickets - varies by operation
  | "tickets.create"
  | "tickets.list"
  | "tickets.get"
  | "tickets.commit"
  | "tickets.revoke"
  | "tickets.delete"
  // Depots - user or agent
  | "depots.create"
  | "depots.list"
  | "depots.get"
  | "depots.update"
  | "depots.commit"
  | "depots.delete"
  // Nodes - varies by operation
  | "nodes.prepare"
  | "nodes.getMetadata"
  | "nodes.get"
  | "nodes.put";

/**
 * Permission requirements for each API.
 * null means public (no auth required).
 * Array means any of the listed auth types are allowed.
 */
const API_PERMISSIONS: Record<ApiName, AuthType[] | null> = {
  // OAuth - public
  "oauth.getConfig": null,
  "oauth.exchangeCode": null,
  "oauth.login": null,
  "oauth.refresh": null,
  // OAuth - authenticated
  "oauth.getMe": ["user"],
  // AWP Client - public
  "auth.initClient": null,
  "auth.pollClient": null,
  // AWP Client - user only
  "auth.completeClient": ["user"],
  "auth.listClients": ["user"],
  "auth.revokeClient": ["user"],
  // Agent Token - user only
  "auth.createAgentToken": ["user"],
  "auth.listAgentTokens": ["user"],
  "auth.revokeAgentToken": ["user"],
  // Admin - admin user only (role check done separately)
  "admin.listUsers": ["user"],
  "admin.updateUserRole": ["user"],
  // MCP - user or agent
  "mcp.call": ["user", "token"],
  // Realm - user, agent, or ticket
  "realm.getInfo": ["user", "token", "ticket"],
  "realm.getUsage": ["user", "token", "ticket"],
  // Tickets
  "tickets.create": ["user", "token"],
  "tickets.list": ["user", "token"],
  "tickets.get": ["user", "token", "ticket"],
  "tickets.commit": ["ticket"],
  "tickets.revoke": ["user", "token"],
  "tickets.delete": ["user"],
  // Depots
  "depots.create": ["user", "token"],
  "depots.list": ["user", "token", "ticket"],
  "depots.get": ["user", "token", "ticket"],
  "depots.update": ["user", "token"],
  "depots.commit": ["user", "token"],
  "depots.delete": ["user", "token"],
  // Nodes
  "nodes.prepare": ["user", "token", "ticket"],
  "nodes.getMetadata": ["user", "token", "ticket"],
  "nodes.get": ["user", "token", "ticket"],
  "nodes.put": ["user", "token", "ticket"],
};

/**
 * Check if the current auth state can access the specified API.
 */
export const canAccess = (authState: AuthState | null, api: ApiName): boolean => {
  const required = API_PERMISSIONS[api];

  // Public API
  if (required === null) {
    return true;
  }

  // No auth state but API requires auth
  if (!authState) {
    return false;
  }

  return required.includes(authState.type);
};

/**
 * Assert that the current auth state can access the specified API.
 * Throws a CasfaError if not authorized.
 */
export const assertAccess = (authState: AuthState | null, api: ApiName): void => {
  if (!canAccess(authState, api)) {
    const required = API_PERMISSIONS[api];
    throw createPermissionError(api, required ?? ["none"]);
  }
};

/**
 * Get required auth types for an API.
 */
export const getRequiredAuth = (api: ApiName): AuthType[] | null => {
  return API_PERMISSIONS[api];
};

/**
 * Check if API is public (no auth required).
 */
export const isPublicApi = (api: ApiName): boolean => {
  return API_PERMISSIONS[api] === null;
};

/**
 * Result type for permission check with detailed info.
 */
export type PermissionCheckResult = { allowed: true } | { allowed: false; error: CasfaError };

/**
 * Check permission and return result object.
 */
export const checkPermission = (
  authState: AuthState | null,
  api: ApiName
): PermissionCheckResult => {
  if (canAccess(authState, api)) {
    return { allowed: true };
  }

  const required = API_PERMISSIONS[api];
  return {
    allowed: false,
    error: createPermissionError(api, required ?? ["none"]),
  };
};
