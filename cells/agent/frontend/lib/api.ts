import { apiFetch } from "./auth.ts";

const realmId = () => "me";

export type Thread = {
  threadId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
};

export type MessageContentPart =
  | { type: "text"; text: string }
  | { type: "tool-call"; callId: string; name: string; arguments: string }
  | { type: "tool-result"; callId: string; result: string };

export type Message = {
  messageId: string;
  threadId: string;
  role: "user" | "assistant" | "system";
  content: MessageContentPart[];
  createdAt: number;
  modelId?: string;
};

export type Setting = {
  key: string;
  value: unknown;
  updatedAt: number;
};

export async function getThreads(limit?: number, cursor?: string): Promise<{ threads: Thread[]; nextCursor: string | null }> {
  const params = new URLSearchParams();
  if (limit) params.set("limit", String(limit));
  if (cursor) params.set("cursor", cursor);
  const res = await apiFetch(`/api/realm/${realmId()}/threads?${params}`);
  if (!res.ok) throw new Error(`getThreads: ${res.status}`);
  return res.json();
}

export async function getThread(threadId: string): Promise<Thread> {
  const res = await apiFetch(`/api/realm/${realmId()}/threads/${threadId}`);
  if (!res.ok) throw new Error(`getThread: ${res.status}`);
  return res.json();
}

export async function createThread(body: { title: string }): Promise<Thread> {
  const res = await apiFetch(`/api/realm/${realmId()}/threads`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`createThread: ${res.status}`);
  return res.json();
}

export async function patchThread(threadId: string, body: { title?: string }): Promise<Thread> {
  const res = await apiFetch(`/api/realm/${realmId()}/threads/${threadId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`patchThread: ${res.status}`);
  return res.json();
}

export async function deleteThread(threadId: string): Promise<void> {
  const res = await apiFetch(`/api/realm/${realmId()}/threads/${threadId}`, { method: "DELETE" });
  if (!res.ok) throw new Error(`deleteThread: ${res.status}`);
}

export async function getMessages(threadId: string, limit?: number, cursor?: string): Promise<{ messages: Message[]; nextCursor: string | null }> {
  const params = new URLSearchParams();
  if (limit) params.set("limit", String(limit));
  if (cursor) params.set("cursor", cursor);
  const res = await apiFetch(`/api/realm/${realmId()}/threads/${threadId}/messages?${params}`);
  if (!res.ok) throw new Error(`getMessages: ${res.status}`);
  return res.json();
}

export async function createMessage(
  threadId: string,
  body: { role: "user" | "assistant" | "system"; content: MessageContentPart[]; modelId?: string }
): Promise<Message> {
  const res = await apiFetch(`/api/realm/${realmId()}/threads/${threadId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`createMessage: ${res.status}`);
  return res.json();
}

export async function getSettings(): Promise<{ items: Setting[] }> {
  const res = await apiFetch(`/api/realm/${realmId()}/settings`);
  if (!res.ok) throw new Error(`getSettings: ${res.status}`);
  return res.json();
}

export async function getSetting(key: string): Promise<{ value: unknown; updatedAt: number } | null> {
  const res = await apiFetch(`/api/realm/${realmId()}/settings/${encodeURIComponent(key)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`getSetting: ${res.status}`);
  const j = await res.json();
  return { value: j.value, updatedAt: j.updatedAt };
}

export async function setSetting(key: string, value: unknown): Promise<Setting> {
  const res = await apiFetch(`/api/realm/${realmId()}/settings/${encodeURIComponent(key)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ value }),
  });
  if (!res.ok) throw new Error(`setSetting: ${res.status}`);
  return res.json();
}
