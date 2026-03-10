/**
 * messages.send: POST user message, call LLM (stream or non-stream), POST assistant message, emit Changes.
 * stream.cancel: abort in-flight request and emit stream.error.
 */
import type { Change, Message, MessageContent, ModelState, StreamChunk, TextContent } from "../lib/model-types.ts";
import type { OpenAIFormatTool } from "./mcp-scenario-tools.ts";
import { buildToolsAndPromptForThread } from "./mcp-scenario-tools.ts";
import * as api from "./api.ts";

const LLM_PROVIDERS_KEY = "llm.providers";

type LLMProvider = {
  id: string;
  baseUrl: string;
  apiKey?: string;
  models: Array<{ id: string; name?: string }>;
};

function parseProviders(value: unknown): LLMProvider[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (p): p is LLMProvider =>
      typeof p === "object" &&
      p !== null &&
      typeof (p as LLMProvider).id === "string" &&
      typeof (p as LLMProvider).baseUrl === "string" &&
      Array.isArray((p as LLMProvider).models)
  );
}

export function getProviderAndModel(
  state: ModelState,
  threadId: string,
  preferredModelId?: string
): { provider: LLMProvider; modelId: string } | null {
  const raw = state.settings[LLM_PROVIDERS_KEY];
  const providers = parseProviders(raw);
  if (providers.length === 0) return null;
  const lastAssistant = (state.messagesByThread[threadId] ?? [])
    .filter((m) => m.role === "assistant")
    .pop();
  const modelId =
    preferredModelId ??
    lastAssistant?.modelId ??
    providers[0]?.models[0]?.id ??
    "";
  if (!modelId) return null;
  const provider = providers.find((p) => p.models.some((m) => m.id === modelId)) ?? providers[0];
  return { provider, modelId };
}

/** Chat history for OpenAI-style API: role + single content string (text only). */
type ChatTurn = { role: "user" | "assistant" | "system"; content: string };

function messageToTurn(m: Message): ChatTurn | null {
  const text = m.content
    .filter((c): c is TextContent => c.type === "text")
    .map((c) => c.text)
    .join("");
  return { role: m.role as "user" | "assistant" | "system", content: text };
}

/** Non-streaming: POST to provider /chat/completions, return assistant content. */
export async function callLlm(
  provider: LLMProvider,
  modelId: string,
  turns: ChatTurn[]
): Promise<string> {
  const base = provider.baseUrl.replace(/\/$/, "");
  const url = `${base}/chat/completions`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: modelId,
      messages: turns,
      stream: false,
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`LLM failed (${res.status}): ${t.slice(0, 200)}`);
  }
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = data.choices?.[0]?.message?.content;
  return typeof content === "string" ? content : "";
}

/** Streaming: POST with stream: true, invoke onChunk for each text delta. Optional tools added to request when provided. */
export async function callLlmStream(
  provider: LLMProvider,
  modelId: string,
  turns: ChatTurn[],
  opts: { signal?: AbortSignal; onChunk: (text: string) => void; tools?: OpenAIFormatTool[] }
): Promise<void> {
  const base = provider.baseUrl.replace(/\/$/, "");
  const url = `${base}/chat/completions`;
  const body: Record<string, unknown> = {
    model: modelId,
    messages: turns,
    stream: true,
  };
  if (opts.tools != null && opts.tools.length > 0) {
    body.tools = opts.tools;
  }
  const res = await fetch(url, {
    method: "POST",
    signal: opts.signal,
    headers: {
      "Content-Type": "application/json",
      ...(provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`LLM stream failed (${res.status}): ${t.slice(0, 200)}`);
  }
  const reader = res.body?.getReader();
  if (!reader) throw new Error("No response body");
  const dec = new TextDecoder();
  let buf = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (line.startsWith("data: ")) {
        const raw = line.slice(6);
        if (raw === "[DONE]") continue;
        try {
          const j = JSON.parse(raw) as { choices?: Array<{ delta?: { content?: string } }> };
          const content = j.choices?.[0]?.delta?.content;
          if (typeof content === "string" && content) opts.onChunk(content);
        } catch {
          /* skip invalid JSON */
        }
      }
    }
  }
}

export type ApplyAndBroadcast = (change: Change) => Promise<void>;

export type RegisterAbort = (messageId: string, controller: AbortController) => void;
export type UnregisterAbort = (messageId: string) => void;

/**
 * Called once the stream has been accepted and streaming has started (before LLM bytes arrive).
 * Used so the frontend can resolve the sendMessage promise quickly and avoid fake "SW response timeout".
 */
export type OnStreamStarted = () => void;

/**
 * Run messages.send: save user message, call LLM (streaming), save assistant message, emit Changes.
 * Uses tempMessageId for the stream; stream.done carries the final message from the backend.
 * Calls onStreamStarted (if provided) after emitting stream.status "streaming", so the client can ack the request without waiting for the full reply.
 */
export async function runMessagesSend(
  threadId: string,
  content: MessageContent[],
  modelId: string | undefined,
  state: ModelState,
  applyAndBroadcast: ApplyAndBroadcast,
  registerAbort: RegisterAbort,
  unregisterAbort: UnregisterAbort,
  onStreamStarted?: OnStreamStarted
): Promise<void> {
  const pm = getProviderAndModel(state, threadId, modelId);
  if (!pm) throw new Error("No LLM provider/model configured");

  const userMessage = await api.createMessage(threadId, { role: "user", content });
  const userMsg: Message = {
    messageId: userMessage.messageId,
    threadId: userMessage.threadId,
    role: "user",
    content: userMessage.content as MessageContent[],
    createdAt: userMessage.createdAt,
  };
  await applyAndBroadcast({ kind: "messages.append", payload: { threadId, message: userMsg } });

  const threadMessages = (state.messagesByThread[threadId] ?? []).concat([userMsg]);
  const threadTurns: ChatTurn[] = threadMessages.map((m) => messageToTurn(m)).filter(Boolean) as ChatTurn[];

  const { systemPromptText, tools } = await buildToolsAndPromptForThread(state, threadId);
  const turns: ChatTurn[] = systemPromptText
    ? [{ role: "system", content: systemPromptText }, ...threadTurns]
    : threadTurns;

  const tempMessageId = `stream_${threadId}_${Date.now()}`;
  const controller = new AbortController();
  registerAbort(tempMessageId, controller);

  await applyAndBroadcast({
    kind: "stream.status",
    payload: { messageId: tempMessageId, threadId, status: "waiting_agent" },
  });
  await applyAndBroadcast({
    kind: "stream.status",
    payload: { messageId: tempMessageId, threadId, status: "streaming" },
  });

  onStreamStarted?.();

  // Task 8: dispatch tool_calls via executeMetaTool(name, args, state, threadId).
  const chunks: StreamChunk[] = [];
  try {
    await callLlmStream(pm.provider, pm.modelId, turns, {
      signal: controller.signal,
      onChunk(text) {
        const chunk: StreamChunk = { type: "text", text };
        chunks.push(chunk);
        applyAndBroadcast({ kind: "stream.chunk", payload: { messageId: tempMessageId, threadId, chunk } });
      },
      tools,
    });
  } catch (err) {
    unregisterAbort(tempMessageId);
    const message = err instanceof Error ? err.message : String(err);
    await applyAndBroadcast({
      kind: "stream.error",
      payload: { messageId: tempMessageId, threadId, error: message },
    });
    throw err;
  }

  unregisterAbort(tempMessageId);
  const fullText = chunks
    .filter((c): c is TextContent => c.type === "text")
    .map((c) => c.text)
    .join("");
  const assistantContent: MessageContent[] = [{ type: "text", text: fullText }];
  const assistantMessage = await api.createMessage(threadId, {
    role: "assistant",
    content: assistantContent,
    modelId: pm.modelId,
  });
  const assistantMsg: Message = {
    messageId: assistantMessage.messageId,
    threadId: assistantMessage.threadId,
    role: "assistant",
    content: assistantMessage.content as MessageContent[],
    createdAt: assistantMessage.createdAt,
    modelId: assistantMessage.modelId,
  };
  await applyAndBroadcast({
    kind: "stream.done",
    payload: { messageId: tempMessageId, threadId, message: assistantMsg },
  });
}

/**
 * Run stream.cancel: abort the fetch for the given messageId (temp id) and emit stream.error.
 */
export async function runStreamCancel(
  messageId: string,
  threadId: string,
  abort: (messageId: string) => AbortController | undefined,
  applyAndBroadcast: ApplyAndBroadcast
): Promise<void> {
  const ctrl = abort(messageId);
  if (ctrl) {
    ctrl.abort();
    await applyAndBroadcast({
      kind: "stream.error",
      payload: { messageId, threadId, error: "Cancelled" },
    });
  }
}
