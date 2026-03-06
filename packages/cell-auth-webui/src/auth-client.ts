import type { AuthClient } from "./types.ts";

export function createAuthClient(params: {
  /** SSO base URL (e.g. https://auth.example.com). */
  ssoBaseUrl: string;
  /** Logout path (e.g. /oauth/logout). */
  logoutEndpoint: string;
}): AuthClient {
  const logoutUrl = `${params.ssoBaseUrl.replace(/\/$/, "")}${params.logoutEndpoint.startsWith("/") ? "" : "/"}${params.logoutEndpoint}`;
  const listeners = new Set<(auth: null) => void>();

  function notify() {
    for (const fn of listeners) fn(null);
  }

  const client: AuthClient = {
    getAuth() {
      return null;
    },

    setTokens() {
      /* no-op: cookie-only, no localStorage */
    },

    logout() {
      fetch(logoutUrl, { method: "POST", credentials: "include" })
        .catch(() => {})
        .finally(() => {
          notify();
        });
    },

    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };

  return client;
}
