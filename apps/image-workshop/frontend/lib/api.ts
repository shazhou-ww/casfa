import { getAuth, logout } from "./auth";

export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const auth = getAuth();
  const headers = new Headers(init?.headers);
  if (auth) headers.set("Authorization", `Bearer ${auth.token}`);
  if (!headers.has("Content-Type") && init?.body) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(path, { ...init, headers });
  if (res.status === 401) {
    logout();
  }
  return res;
}
