/**
 * Call LLM chat completion (OpenAI-style). Frontend only; no backend proxy.
 */
import type { LLMProvider } from "../stores/agent-store.ts";

export type ChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

export async function callChatCompletion(
  provider: LLMProvider,
  modelId: string,
  messages: ChatMessage[]
): Promise<string> {
  const base = provider.baseUrl.replace(/\/$/, "");
  const url = `${base}/chat/completions`;
  const body = {
    model: modelId,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
    stream: false,
  };
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`LLM request failed (${res.status}): ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content;
  return typeof content === "string" ? content : "";
}
