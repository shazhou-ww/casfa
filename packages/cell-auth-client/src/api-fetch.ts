import type { AuthClient } from "./types.ts";

export function createApiFetch(params: {
  authClient: AuthClient;
  baseUrl: string;
  onUnauthorized: () => void;
  /** When true, do not set Authorization header; rely on cookies only. */
  cookieOnly?: boolean;
}): (path: string, init: RequestInit | null) => Promise<Response> {
  const { authClient, baseUrl, onUnauthorized, cookieOnly = false } = params;

  return async (path, init) => {
    const headers = new Headers(init?.headers);
    if (!cookieOnly) {
      const auth = authClient.getAuth();
      if (auth) headers.set("Authorization", `Bearer ${auth.token}`);
    }
    if (!headers.has("Content-Type") && init?.body) {
      headers.set("Content-Type", "application/json");
    }

    const res = await fetch(`${baseUrl}${path}`, { ...init, headers, credentials: "include" });
    if (res.status === 401) {
      onUnauthorized();
    }
    return res;
  };
}
