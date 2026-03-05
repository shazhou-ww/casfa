import type { AuthClient } from "./types.ts";

export function createApiFetch(params: {
  authClient: AuthClient;
  baseUrl: string;
  onUnauthorized: () => void;
}): (path: string, init: RequestInit | null) => Promise<Response> {
  const { authClient, baseUrl, onUnauthorized } = params;

  return async (path, init) => {
    const auth = authClient.getAuth();
    const headers = new Headers(init?.headers);
    if (auth) headers.set("Authorization", `Bearer ${auth.token}`);
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
