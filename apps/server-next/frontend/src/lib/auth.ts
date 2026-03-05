import { createApiFetch, createAuthClient } from "@casfa/cell-auth-client";
import { useSyncExternalStore } from "react";

export const authClient = createAuthClient({ storagePrefix: "casfa-next" });

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
  onUnauthorized: () => authClient.logout(),
});

/**
 * Central fetch that attaches Authorization: Bearer from cell-auth-client and
 * calls onUnauthorized (logout) on 401. Use this for all /api/* requests that require auth.
 * Accepts path (string) or full URL; when URL is passed, path is taken relative to same origin.
 */
export async function apiFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
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
