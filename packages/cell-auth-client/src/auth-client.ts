import type { AuthClient, AuthSubscriber, ClientAuth } from "./types.ts";

export function createAuthClient(params: {
  storagePrefix: string;
  /** SSO base URL. When set, cookie-only mode: no localStorage, getAuth() returns null; logout uses ssoBaseUrl + logoutEndpoint. */
  ssoBaseUrl?: string;
  /** Path for logout (e.g. "/oauth/logout"). Used with ssoBaseUrl. */
  logoutEndpoint?: string;
}): AuthClient {
  const tokenKey = `${params.storagePrefix}_token`;
  const refreshKey = `${params.storagePrefix}_refresh`;
  const cookieOnly = Boolean(params.ssoBaseUrl);
  const logoutUrl =
    params.ssoBaseUrl && params.logoutEndpoint
      ? `${params.ssoBaseUrl.replace(/\/$/, "")}${params.logoutEndpoint.startsWith("/") ? "" : "/"}${params.logoutEndpoint}`
      : params.logoutEndpoint;

  let currentAuth: ClientAuth | null = null;
  const listeners = new Set<AuthSubscriber>();

  function notify() {
    const auth = currentAuth;
    for (const fn of listeners) fn(auth);
  }

  function parseTokenPayload(token: string): { userId: string; email: string } | null {
    try {
      const parts = token.split(".");
      if (parts.length < 2) return null;
      const payload = JSON.parse(atob(parts[1]!));
      if (typeof payload.sub !== "string" || typeof payload.email !== "string") return null;
      return { userId: payload.sub, email: payload.email };
    } catch {
      return null;
    }
  }

  const client: AuthClient = {
    getAuth() {
      if (cookieOnly) return null;
      if (currentAuth) return currentAuth;
      const stored = localStorage.getItem(tokenKey);
      if (!stored) return null;
      const parsed = parseTokenPayload(stored);
      if (!parsed) {
        localStorage.removeItem(tokenKey);
        return null;
      }
      const refreshToken = localStorage.getItem(refreshKey);
      currentAuth = {
        token: stored,
        userId: parsed.userId,
        email: parsed.email,
        refreshToken,
      };
      return currentAuth;
    },

    setTokens(token, refreshToken) {
      if (cookieOnly) return;
      localStorage.setItem(tokenKey, token);
      if (refreshToken) {
        localStorage.setItem(refreshKey, refreshToken);
      } else {
        localStorage.removeItem(refreshKey);
      }
      currentAuth = null;
      client.getAuth();
      notify();
    },

    logout() {
      if (logoutUrl) {
        fetch(logoutUrl, { method: "POST", credentials: "include" })
          .catch(() => {})
          .finally(() => {
            if (!cookieOnly) {
              localStorage.removeItem(tokenKey);
              localStorage.removeItem(refreshKey);
            }
            currentAuth = null;
            notify();
          });
      } else {
        if (!cookieOnly) {
          localStorage.removeItem(tokenKey);
          localStorage.removeItem(refreshKey);
        }
        currentAuth = null;
        notify();
      }
    },

    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };

  return client;
}
