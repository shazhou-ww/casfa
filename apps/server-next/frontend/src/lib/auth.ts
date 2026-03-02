import { useAuthStore } from "../stores/auth-store";

const UNAUTHORIZED_MESSAGE = "请重新登录";

/**
 * Central fetch that attaches Authorization: Bearer <token> when the auth store
 * has a token (e.g. from mock-token when authType is mock). Use this for all
 * /api/* requests that require auth.
 * On 401: if authType is mock, tries to refresh token once and retries; otherwise
 * logs out and throws. Callers can catch to show "请重新登录".
 */
export async function apiFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const store = useAuthStore.getState();
  const token = store.getToken();
  const authType = store.authType;
  const headers = new Headers(init?.headers);
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  let res = await fetch(input, { ...init, headers });

  if (res.status === 401 && authType === "mock") {
    const tokenRes = await fetch("/api/dev/mock-token");
    if (tokenRes.ok) {
      const data = (await tokenRes.json()) as { token?: string };
      const newToken = data.token ?? null;
      if (newToken) {
        store.setToken(newToken);
        const retryHeaders = new Headers(init?.headers);
        retryHeaders.set("Authorization", `Bearer ${newToken}`);
        res = await fetch(input, { ...init, headers: retryHeaders });
      }
    }
  }

  if (res.status === 401) {
    useAuthStore.getState().logout();
    throw new Error(UNAUTHORIZED_MESSAGE);
  }

  return res;
}
