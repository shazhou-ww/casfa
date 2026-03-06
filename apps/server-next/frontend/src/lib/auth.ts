import type { AuthClient } from "@casfa/cell-auth-client";
import { createApiFetch, createAuthClient } from "@casfa/cell-auth-client";
import { useEffect, useState, useSyncExternalStore } from "react";

let authClientInstance: AuthClient | null = null;
let apiFetchInstance: ((path: string, init: RequestInit | null) => Promise<Response>) | null = null;
let ssoBaseUrlValue: string | undefined = undefined;
/** In SSO mode, /api/me response is cached so fs-api etc. can get realmId (userId). */
let cookieUser: { userId: string; email?: string; name?: string; picture?: string } | null = null;

export type AuthConfig = { ssoBaseUrl?: string | null };

export function setCookieUser(user: { userId: string; email?: string; name?: string; picture?: string } | null): void {
  cookieUser = user;
}

export function getCookieUser(): { userId: string; email?: string; name?: string; picture?: string } | null {
  return cookieUser;
}

/** realmId for user auth is userId. Works in both token and SSO (cookie) mode. */
export function getRealmId(): string | null {
  const fromAuth = authClientInstance?.getAuth()?.userId;
  if (fromAuth) return fromAuth;
  return cookieUser?.userId ?? null;
}

/** Hook: realmId (userId) for current user. Use in components; for non-React code use getRealmId(). */
export function useRealmId(): string | null {
  const authUserId = useAuth()?.userId;
  return authUserId ?? getCookieUser()?.userId ?? null;
}

/** Hook: current user for display (userId, email). Works in both token and SSO (cookie) mode. */
export function useCurrentUser(): { userId: string; email?: string } | null {
  const auth = useAuth();
  if (auth) return { userId: auth.userId, email: auth.email };
  const cookie = getCookieUser();
  return cookie ? { userId: cookie.userId, email: cookie.email } : null;
}

/**
 * Fetch auth config from backend (/api/info) and create auth client / api fetch.
 * Call once before rendering app. No Vite build-time env needed.
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
  ssoBaseUrlValue = ssoBaseUrl;

  if (ssoBaseUrl) {
    try {
      await fetch("/api/csrf", { credentials: "include" });
    } catch {
      /* non-blocking; write requests will fail with CSRF until next successful fetch */
    }
  }

  authClientInstance = createAuthClient({
    storagePrefix: "casfa-next",
    ssoBaseUrl,
    logoutEndpoint: "/oauth/logout",
  });

  apiFetchInstance = createApiFetch({
    authClient: authClientInstance,
    baseUrl: "",
    onUnauthorized: () => {
      authClientInstance!.logout();
      window.location.replace(ssoBaseUrl ? "/oauth/login" : "/login");
    },
    csrfCookieName: ssoBaseUrl ? "csrf_token" : undefined,
    ssoBaseUrl,
    ssoRefreshPath: ssoBaseUrl ? "/oauth/refresh" : undefined,
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

/** Hook: current auth from cell-auth-client (re-renders on login/logout). */
export function useAuth() {
  const client = authClientInstance;
  return useSyncExternalStore(
    (onStoreChange) => (client ? client.subscribe(() => onStoreChange()) : () => {}),
    () => (client ? client.getAuth() : null),
    () => (client ? client.getAuth() : null)
  );
}

/** In SSO mode (ssoBaseUrl set), getAuth() is always null (cookie is httpOnly). Use this to probe /api/me and cache user for getRealmId(). */
export function useCookieAuthCheck(): { loading: boolean; isLoggedIn: boolean } {
  const [state, setState] = useState<{ loading: boolean; isLoggedIn: boolean }>({
    loading: true,
    isLoggedIn: false,
  });
  useEffect(() => {
    let cancelled = false;
    fetch("/api/me", { credentials: "include" })
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
 * Central fetch that attaches Authorization: Bearer from cell-auth-client and
 * calls onUnauthorized (logout) on 401. Use this for all /api/* requests that require auth.
 * Accepts path (string) or full URL; when URL is passed, path is taken relative to same origin.
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
