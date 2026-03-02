import { useAuthStore } from "../stores/auth-store";

/**
 * Central fetch that attaches Authorization: Bearer <token> when the auth store
 * has a token (e.g. from mock-token when authType is mock). Use this for all
 * /api/* requests that require auth.
 */
export async function apiFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const token = useAuthStore.getState().getToken();
  const headers = new Headers(init?.headers);
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  return fetch(input, { ...init, headers });
}
