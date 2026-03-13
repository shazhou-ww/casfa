/**
 * Fetch from Service Worker to same-origin Agent API.
 * Credentials included; CSRF token set by client when connecting (see sw-protocol).
 */
let csrfToken: string | undefined;

export function setCsrfToken(token: string | undefined): void {
  csrfToken = token;
}

const REALM_ID = "me";

function getBaseUrl(): string {
  const scope = self.registration?.scope;
  if (scope) {
    const u = new URL(scope);
    const path = u.pathname.replace(/\/+$/, "");
    return `${u.origin}${path === "/" ? "" : path}`;
  }
  return "";
}

export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const base = getBaseUrl();
  const url = path.startsWith("/") ? `${base}${path}` : `${base}/${path}`;
  const headers = new Headers(init?.headers);
  if (csrfToken && ["POST", "PUT", "PATCH", "DELETE"].includes(init?.method ?? "GET")) {
    headers.set("X-CSRF-Token", csrfToken);
  }
  if (!headers.has("Content-Type") && init?.body && typeof init.body === "string") {
    headers.set("Content-Type", "application/json");
  }
  return fetch(url, { ...init, credentials: "include", headers });
}

export async function createThread(title: string): Promise<{ threadId: string; title: string; createdAt: number; updatedAt: number }> {
  const res = await apiFetch(`/api/realm/${REALM_ID}/threads`, {
    method: "POST",
    body: JSON.stringify({ title }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { message?: string }).message ?? `createThread: ${res.status}`);
  }
  return res.json();
}

export async function deleteThread(threadId: string): Promise<void> {
  const res = await apiFetch(`/api/realm/${REALM_ID}/threads/${threadId}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`deleteThread: ${res.status}`);
}

export async function listThreads(limit = 100): Promise<{ threads: { threadId: string; title: string; createdAt: number; updatedAt: number }[] }> {
  const res = await apiFetch(`/api/realm/${REALM_ID}/threads?limit=${limit}`);
  if (!res.ok) throw new Error(`listThreads: ${res.status}`);
  return res.json();
}

export async function listMessages(threadId: string, limit = 500): Promise<{ messages: unknown[] }> {
  const res = await apiFetch(`/api/realm/${REALM_ID}/threads/${threadId}/messages?limit=${limit}`);
  if (!res.ok) throw new Error(`listMessages: ${res.status}`);
  return res.json();
}

export async function listSettings(): Promise<{ items: { key: string; value: unknown }[] }> {
  const res = await apiFetch("/api/me/settings");
  if (!res.ok) throw new Error(`listSettings: ${res.status}`);
  return res.json();
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  const res = await apiFetch(`/api/me/settings/${encodeURIComponent(key)}`, {
    method: "PUT",
    body: JSON.stringify({ value }),
  });
  if (!res.ok) throw new Error(`setSetting: ${res.status}`);
}

export type CreateMessageBody = {
  role: "user" | "assistant" | "system";
  content: unknown[];
  modelId?: string;
};

export async function createMessage(
  threadId: string,
  body: CreateMessageBody
): Promise<{ messageId: string; threadId: string; role: string; content: unknown[]; createdAt: number; modelId?: string }> {
  const res = await apiFetch(`/api/realm/${REALM_ID}/threads/${threadId}/messages`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`createMessage: ${res.status}`);
  return res.json();
}
