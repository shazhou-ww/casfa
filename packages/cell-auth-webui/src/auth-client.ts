import type { AuthClient } from "./types.ts";

/** Clear a cookie by name/path (must match how the server set it). */
function clearCookie(name: string, path: string = "/"): void {
  if (typeof document === "undefined") return;
  document.cookie = `${name}=; Path=${path}; Max-Age=0; SameSite=Strict`;
}

export function createAuthClient(params: {
  /** SSO base URL (e.g. https://auth.example.com). */
  ssoBaseUrl: string;
  /** Logout path (e.g. /oauth/logout). */
  logoutEndpoint: string;
  /** If set, clear this CSRF cookie on logout (same name/path as backend). */
  clearCsrfOnLogout?: { cookieName: string; path?: string };
  /**
   * If set, after SSO logout completes the client will redirect here (e.g. business cell login page).
   * Uses return_url param so the user can be sent back after signing in again.
   */
  redirectAfterLogout?: {
    /** Path on current origin (e.g. /oauth/login). */
    path: string;
    /** Query param name for return URL (default "return_url"). */
    returnUrlParam?: string;
    /** Return URL to encode (default: window.location.origin + "/"). */
    getReturnUrl?: () => string;
  };
}): AuthClient {
  const logoutUrl = `${params.ssoBaseUrl.replace(/\/$/, "")}${params.logoutEndpoint.startsWith("/") ? "" : "/"}${params.logoutEndpoint}`;
  const listeners = new Set<(auth: null) => void>();
  const csrfClear = params.clearCsrfOnLogout;
  const redirect = params.redirectAfterLogout;

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
      return fetch(logoutUrl, { method: "POST", credentials: "include" })
        .catch(() => {})
        .finally(() => {
          if (csrfClear) clearCookie(csrfClear.cookieName, csrfClear.path ?? "/");
          notify();
        })
        .then(() => {
          if (redirect && typeof window !== "undefined") {
            const param = redirect.returnUrlParam ?? "return_url";
            const returnUrl = redirect.getReturnUrl?.() ?? `${window.location.origin}/`;
            const url = `${redirect.path}?${param}=${encodeURIComponent(returnUrl)}`;
            window.location.replace(url);
          }
        });
    },

    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };

  return client;
}
