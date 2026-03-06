import type { AuthClient } from "./types.ts";

/** Parse document.cookie and return value for the given name, or null. Browser only. */
function getCookieValue(name: string): string | null {
  if (typeof document === "undefined" || !document.cookie) return null;
  const parts = document.cookie.split(";");
  for (const part of parts) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    if (key !== name) continue;
    return part.slice(eq + 1).trim() || null;
  }
  return null;
}

export function createApiFetch(params: {
  authClient: AuthClient;
  baseUrl: string;
  onUnauthorized: () => void;
  /** Cookie name for CSRF token (e.g. "csrf_token"). When set, add X-CSRF-Token header from document.cookie. */
  csrfCookieName?: string;
  /** SSO base URL. When set, cookie-only: do not set Authorization header (rely on cookies). */
  ssoBaseUrl?: string;
  /** Path for refresh (e.g. "/oauth/refresh"). Used with ssoBaseUrl. */
  ssoRefreshPath?: string;
}): (path: string, init: RequestInit | null) => Promise<Response> {
  const {
    authClient,
    baseUrl,
    onUnauthorized,
    csrfCookieName,
    ssoBaseUrl,
    ssoRefreshPath,
  } = params;
  const cookieOnly = Boolean(ssoBaseUrl);

  return async (path, init) => {
    const headers = new Headers(init?.headers);
    if (!cookieOnly) {
      const auth = authClient.getAuth();
      if (auth) headers.set("Authorization", `Bearer ${auth.token}`);
    }
    if (csrfCookieName) {
      const csrf = getCookieValue(csrfCookieName);
      if (csrf) headers.set("X-CSRF-Token", csrf);
    }
    if (!headers.has("Content-Type") && init?.body) {
      headers.set("Content-Type", "application/json");
    }

    let res = await fetch(`${baseUrl}${path}`, { ...init, headers, credentials: "include" });

    if (res.status === 401 && ssoBaseUrl && ssoRefreshPath) {
      const refreshUrl = `${ssoBaseUrl.replace(/\/$/, "")}${ssoRefreshPath.startsWith("/") ? "" : "/"}${ssoRefreshPath}`;
      const refreshRes = await fetch(refreshUrl, {
        method: "POST",
        credentials: "include",
      });
      if (refreshRes.ok) {
        res = await fetch(`${baseUrl}${path}`, { ...init, headers, credentials: "include" });
      }
    }

    if (res.status === 401) {
      onUnauthorized();
    }
    return res;
  };
}
