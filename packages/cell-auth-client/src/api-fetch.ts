import type { AuthClient } from "./types.ts";

/**
 * Api fetch for CLI / non-browser: adds Authorization: Bearer from authClient.
 * On 401 calls onUnauthorized. No cookie, no CSRF, no refresh.
 */
export function createApiFetch(params: {
  authClient: AuthClient;
  baseUrl: string;
  onUnauthorized: () => void;
}): (path: string, init: RequestInit | null) => Promise<Response> {
  const { authClient, baseUrl, onUnauthorized } = params;

  return async (path, init) => {
    const headers = new Headers(init?.headers);
    const auth = authClient.getAuth();
    if (auth) headers.set("Authorization", `Bearer ${auth.token}`);
    if (!headers.has("Content-Type") && init?.body) {
      headers.set("Content-Type", "application/json");
    }

    const res = await fetch(`${baseUrl}${path}`, { ...init, headers });

    if (res.status === 401) {
      onUnauthorized();
    }
    return res;
  };
}
