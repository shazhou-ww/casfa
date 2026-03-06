import type { AuthClient } from "@casfa/cell-auth-webui";
import { createApiFetch, createAuthClient } from "@casfa/cell-auth-webui";
import { useEffect, useState, useSyncExternalStore } from "react";

let authClientInstance: AuthClient | null = null;
let apiFetchInstance: ((path: string, init: RequestInit | null) => Promise<Response>) | null = null;
let ssoBaseUrlValue: string | undefined = undefined;
/** /api/me response is cached so fs-api etc. can get realmId (userId). */
let cookieUser: { userId: string; email?: string; name?: string; picture?: string } | null = null;

export type AuthConfig = { ssoBaseUrl?: string | null };

export function setCookieUser(user: { userId: string; email?: string; name?: string; picture?: string } | null): void {
  cookieUser = user;
}

export function getCookieUser(): { userId: string; email?: string; name?: string; picture?: string } | null {
  return cookieUser;
}

/** realmId for user auth is userId. */
export function getRealmId(): string | null {
  return cookieUser?.userId ?? null;
}

/** Hook: realmId (userId) for current user. Use in components; for non-React code use getRealmId(). */
export function useRealmId(): string | null {
  return getCookieUser()?.userId ?? null;
}

/** Hook: current user for display (userId, email). */
export function useCurrentUser(): { userId: string; email?: string } | null {
  const cookie = getCookieUser();
  return cookie ? { userId: cookie.userId, email: cookie.email } : null;
}

/**
 * Fetch auth config from backend (/api/info) and create auth client / api fetch.
 * SSO only: ssoBaseUrl must be set by backend.
 */
export async function initAuth(): Promise<void> {
  let config: AuthConfig = {};
  try {
    const res = await fetch("/api/info");
    if (res.ok) config = (await res.json()) as AuthConfig;
  } catch {
    /* use defaults */
  }
  const ssoBaseUrl = config.ssoBaseUrl ?? undefined;
  if (!ssoBaseUrl) {
    throw new Error("SSO base URL not configured; backend must return ssoBaseUrl in /api/info.");
  }
  ssoBaseUrlValue = ssoBaseUrl;

  try {
    await fetch("/api/csrf", { credentials: "include" });
  } catch {
    /* non-blocking; write requests will fail with CSRF until next successful fetch */
  }

  authClientInstance = createAuthClient({
    ssoBaseUrl,
    logoutEndpoint: "/oauth/logout",
  });
  apiFetchInstance = createApiFetch({
    authClient: authClientInstance,
    baseUrl: "",
    onUnauthorized: () => {
      console.log("[auth] onUnauthorized: redirecting to /oauth/login");
      window.location.replace("/oauth/login");
      authClientInstance!.logout();
    },
    csrfCookieName: "csrf_token",
    ssoBaseUrl,
    ssoRefreshPath: "/oauth/refresh",
  });
}

export function getSsoBaseUrl(): string | undefined {
  return ssoBaseUrlValue;
}

export function getAuthClient(): AuthClient {
  if (!authClientInstance) throw new Error("Auth not initialized; call initAuth() first.");
  return authClientInstance;
}

/** Same as getAuthClient(); use after initAuth() has run. */
export const authClient: AuthClient = {
  getAuth: () => getAuthClient().getAuth(),
  subscribe: (fn) => getAuthClient().subscribe(fn),
  setTokens: (token, refreshToken) => getAuthClient().setTokens(token, refreshToken),
  logout: () => getAuthClient().logout(),
};

/** Hook: re-renders on login/logout. getAuth() is always null (cookie is httpOnly); use getCookieUser(). */
export function useAuth() {
  const client = authClientInstance;
  return useSyncExternalStore(
    (onStoreChange) => (client ? client.subscribe(() => onStoreChange()) : () => {}),
    () => null,
    () => null
  );
}

/** Probe /api/me and cache user for getRealmId() / useCurrentUser(). Uses apiFetch so 401 → onUnauthorized (redirect to login). */
export function useCookieAuthCheck(): { loading: boolean; isLoggedIn: boolean } {
  const [state, setState] = useState<{ loading: boolean; isLoggedIn: boolean }>({
    loading: true,
    isLoggedIn: false,
  });
  useEffect(() => {
    let cancelled = false;
    if (!apiFetchInstance) {
      setState({ loading: false, isLoggedIn: false });
      return;
    }
    apiFetchInstance("/api/me", null)
      .then(async (res) => {
        if (cancelled) return;
        const data = res.ok ? ((await res.json()) as { userId?: string; email?: string; name?: string; picture?: string }) : null;
        if (data && typeof data.userId === "string") setCookieUser({ userId: data.userId, email: data.email, name: data.name, picture: data.picture });
        else setCookieUser(null);
        setState({ loading: false, isLoggedIn: res.ok });
      })
      .catch(() => {
        if (!cancelled) {
          setCookieUser(null);
          setState({ loading: false, isLoggedIn: false });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return state;
}

/**
 * Central fetch: cookie + CSRF + 401 → SSO refresh then retry. Calls onUnauthorized (redirect to login) on 401.
 */
export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (!apiFetchInstance) throw new Error("Auth not initialized; call initAuth() first.");
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
  return apiFetchInstance(pathOnly, init ?? null);
}
