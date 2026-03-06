import { createApiFetch, createAuthClient } from "@casfa/cell-auth-client";
import { useSyncExternalStore } from "react";

const ssoBaseUrl =
  (typeof import.meta !== "undefined" && (import.meta as { env?: { VITE_SSO_BASE_URL?: string } }).env?.VITE_SSO_BASE_URL) ||
  undefined;

export const authClient = createAuthClient({
  storagePrefix: "casfa-next",
  cookieOnly: !!ssoBaseUrl,
  ssoBaseUrl,
  logoutEndpoint: "/oauth/logout",
});

/** Hook: current auth from cell-auth-client (re-renders on login/logout). */
export function useAuth() {
  return useSyncExternalStore(
    (onStoreChange) => authClient.subscribe(() => onStoreChange()),
    () => authClient.getAuth(),
    () => authClient.getAuth()
  );
}

const cellApiFetch = createApiFetch({
  authClient,
  baseUrl: "",
  onUnauthorized: () => {
    authClient.logout();
    window.location.replace(ssoBaseUrl ? "/oauth/login" : "/login");
  },
  cookieOnly: !!ssoBaseUrl,
  csrfCookieName: ssoBaseUrl ? "csrf_token" : undefined,
  ssoBaseUrl,
  ssoRefreshPath: ssoBaseUrl ? "/oauth/refresh" : undefined,
});

/**
 * Central fetch that attaches Authorization: Bearer from cell-auth-client and
 * calls onUnauthorized (logout) on 401. Use this for all /api/* requests that require auth.
 * Accepts path (string) or full URL; when URL is passed, path is taken relative to same origin.
 */
export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  let path: string;
  if (typeof input === "string") {
    path = input;
  } else if (input instanceof URL) {
    path = input.pathname + input.search;
  } else {
    path = (input as Request).url;
  }
  const pathOnly =
    path.startsWith("http://") || path.startsWith("https://")
      ? new URL(path).pathname + new URL(path).search
      : path;
  return cellApiFetch(pathOnly, init ?? null);
}
