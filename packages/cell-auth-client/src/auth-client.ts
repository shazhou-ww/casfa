import type { AuthClient, AuthSubscriber, ClientAuth } from "./types.ts";

/**
 * Auth client for CLI / non-browser: token in localStorage (or set via setTokens).
 * Requests use Authorization: Bearer. No cookie, no CSRF.
 */
export function createAuthClient(params: { storagePrefix: string }): AuthClient {
  const tokenKey = `${params.storagePrefix}_token`;
  const refreshKey = `${params.storagePrefix}_refresh`;

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
      if (currentAuth) return currentAuth;
      const stored = typeof localStorage !== "undefined" ? localStorage.getItem(tokenKey) : null;
      if (!stored) return null;
      const parsed = parseTokenPayload(stored);
      if (!parsed) {
        if (typeof localStorage !== "undefined") localStorage.removeItem(tokenKey);
        return null;
      }
      const refreshToken =
        typeof localStorage !== "undefined" ? localStorage.getItem(refreshKey) : null;
      currentAuth = {
        token: stored,
        userId: parsed.userId,
        email: parsed.email,
        refreshToken,
      };
      return currentAuth;
    },

    setTokens(token, refreshToken) {
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(tokenKey, token);
        if (refreshToken) {
          localStorage.setItem(refreshKey, refreshToken);
        } else {
          localStorage.removeItem(refreshKey);
        }
      }
      currentAuth = null;
      client.getAuth();
      notify();
    },

    logout() {
      if (typeof localStorage !== "undefined") {
        localStorage.removeItem(tokenKey);
        localStorage.removeItem(refreshKey);
      }
      currentAuth = null;
      notify();
    },

    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };

  return client;
}
