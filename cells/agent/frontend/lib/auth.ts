import type { AuthClient } from "@casfa/cell-auth-webui";
import { createApiFetch, createAuthClient } from "@casfa/cell-auth-webui";
import { useEffect, useState, useSyncExternalStore } from "react";

let authClientInstance: AuthClient | null = null;
let apiFetchInstance: ((path: string, init: RequestInit | null) => Promise<Response>) | null = null;
let ssoBaseUrlValue: string | undefined = undefined;
let cookieUser: { userId: string; email?: string; name?: string; picture?: string } | null = null;

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
  if (normalized === base || normalized.startsWith(base + "/")) return normalized;
  return `${base}${normalized}`;
}

export function setCookieUser(user: { userId: string; email?: string; name?: string; picture?: string } | null): void {
  cookieUser = user;
}

export function getCookieUser(): { userId: string; email?: string; name?: string; picture?: string } | null {
  return cookieUser;
}

export function getRealmId(): string | null {
  return cookieUser?.userId ?? null;
}

export function useRealmId(): string | null {
  return getCookieUser()?.userId ?? null;
}

export function useCurrentUser(): { userId: string; email?: string } | null {
  const cookie = getCookieUser();
  return cookie ? { userId: cookie.userId, email: cookie.email } : null;
}

export async function initAuth(): Promise<void> {
  let config: { ssoBaseUrl?: string | null } = {};
  try {
    const res = await fetch(withMountPath("/api/info"));
    if (res.ok) config = (await res.json()) as { ssoBaseUrl?: string | null };
  } catch {
    /* use defaults */
  }
  const ssoBaseUrl = config.ssoBaseUrl ?? undefined;
  if (!ssoBaseUrl) {
    return;
  }
  ssoBaseUrlValue = ssoBaseUrl;
  try {
    await fetch(withMountPath("/api/csrf"), { credentials: "include" });
  } catch {
    /* non-blocking */
  }
  authClientInstance = createAuthClient({
    ssoBaseUrl,
    // Endpoint under SSO base URL; do not prepend current app mount.
    logoutEndpoint: "/oauth/logout",
    clearCsrfOnLogout: { cookieName: "csrf_token", path: "/" },
    redirectAfterLogout: { path: withMountPath("/oauth/login") },
  });
  apiFetchInstance = createApiFetch({
    authClient: authClientInstance,
    baseUrl: "",
    onUnauthorized: () => {
      const loginUrl = `${withMountPath("/oauth/login")}?return_url=${encodeURIComponent(window.location.href)}`;
      window.location.replace(loginUrl);
    },
    csrfCookieName: "csrf_token",
    ssoBaseUrl,
    // Refresh is hosted by SSO; keep path absolute to SSO base.
    ssoRefreshPath: "/oauth/refresh",
  });
}

export function getSsoBaseUrl(): string | undefined {
  return ssoBaseUrlValue;
}

export function useAuth() {
  const client = authClientInstance;
  return useSyncExternalStore(
    (onStoreChange) => (client ? client.subscribe(() => onStoreChange()) : () => {}),
    () => null,
    () => null
  );
}

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
    apiFetchInstance(withMountPath("/api/me"), null)
      .then(async (res) => {
        if (cancelled) return;
        const data = res.ok
          ? ((await res.json()) as { userId?: string; email?: string; name?: string; picture?: string })
          : null;
        if (data && typeof data.userId === "string") {
          setCookieUser({
            userId: data.userId,
            email: data.email,
            name: data.name,
            picture: data.picture,
          });
        } else {
          setCookieUser(null);
        }
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

export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (!apiFetchInstance) {
    return fetch(input, init);
  }
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
  return apiFetchInstance(withMountPath(pathOnly), init ?? null);
}
