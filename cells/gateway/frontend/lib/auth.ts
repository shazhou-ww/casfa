import type { AuthClient } from "@casfa/cell-auth-webui";
import { createApiFetch, createAuthClient } from "@casfa/cell-auth-webui";
import { useEffect, useState } from "react";

type CookieUser = {
  userId: string;
  email?: string;
  name?: string;
  picture?: string;
};

type AuthConfig = {
  ssoBaseUrl?: string | null;
  baseUrl?: string | null;
};

let authClientInstance: AuthClient | null = null;
let apiFetchInstance: ((path: string, init: RequestInit | null) => Promise<Response>) | null = null;
let cookieUser: CookieUser | null = null;
let baseUrlValue: string | undefined = undefined;

function getMountBasePath(): string {
  if (typeof window === "undefined") return "";
  const seg = window.location.pathname.split("/").filter(Boolean)[0];
  return seg ? `/${seg}` : "";
}

export function withMountPath(path: string): string {
  if (/^https?:\/\//.test(path)) return path;
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const base = getMountBasePath();
  if (!base) return normalized;
  if (normalized === base || normalized.startsWith(`${base}/`)) return normalized;
  return `${base}${normalized}`;
}

export function getCookieUser(): CookieUser | null {
  return cookieUser;
}

function setCookieUser(user: CookieUser | null): void {
  cookieUser = user;
}

export async function initAuth(): Promise<void> {
  const infoRes = await fetch(withMountPath("/api/info"));
  if (!infoRes.ok) throw new Error("Failed to load auth config");
  const info = (await infoRes.json()) as AuthConfig;
  const ssoBaseUrl = info.ssoBaseUrl ?? undefined;
  baseUrlValue = info.baseUrl ?? undefined;
  if (!ssoBaseUrl) throw new Error("SSO not configured");

  authClientInstance = createAuthClient({
    ssoBaseUrl,
    logoutEndpoint: "/oauth/logout",
    redirectAfterLogout: { path: withMountPath("/oauth/login") },
  });
  apiFetchInstance = createApiFetch({
    authClient: authClientInstance,
    baseUrl: "",
    onUnauthorized: () => redirectToLogin(window.location.href),
    csrfCookieName: "",
    ssoBaseUrl,
    ssoRefreshPath: "/oauth/refresh",
  });
}

export function getBaseUrl(): string | undefined {
  return baseUrlValue;
}

export function redirectToLogin(returnUrl: string): void {
  const loginUrl = `${withMountPath("/oauth/login")}?return_url=${encodeURIComponent(returnUrl)}`;
  window.location.replace(loginUrl);
}

export async function apiFetch(path: string, init: RequestInit | null = null): Promise<Response> {
  if (!apiFetchInstance) throw new Error("Auth not initialized");
  return apiFetchInstance(withMountPath(path), init);
}

export const authClient: AuthClient = {
  getAuth: () => {
    if (!authClientInstance) throw new Error("Auth not initialized");
    return authClientInstance.getAuth();
  },
  subscribe: (fn) => {
    if (!authClientInstance) return () => {};
    return authClientInstance.subscribe(fn);
  },
  setTokens: (token, refreshToken) => {
    if (!authClientInstance) throw new Error("Auth not initialized");
    authClientInstance.setTokens(token, refreshToken);
  },
  logout: () => {
    if (!authClientInstance) throw new Error("Auth not initialized");
    return authClientInstance.logout();
  },
};

export function useCookieAuthCheck(): { loading: boolean; isLoggedIn: boolean } {
  const [state, setState] = useState<{ loading: boolean; isLoggedIn: boolean }>({
    loading: true,
    isLoggedIn: false,
  });

  useEffect(() => {
    let cancelled = false;
    apiFetch("/api/me")
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) {
          setCookieUser(null);
          setState({ loading: false, isLoggedIn: false });
          return;
        }
        const user = (await res.json()) as CookieUser;
        setCookieUser(user);
        setState({ loading: false, isLoggedIn: true });
      })
      .catch(() => {
        if (cancelled) return;
        setCookieUser(null);
        setState({ loading: false, isLoggedIn: false });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
