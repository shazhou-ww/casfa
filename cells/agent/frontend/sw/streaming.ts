/**
 * messages.send: POST user message, call LLM (stream or non-stream), POST assistant message, emit Changes.
 * stream.cancel: abort in-flight request and emit stream.error.
 */
import type { Change, Message, MessageContent, ModelState, StreamChunk, TextContent } from "../lib/model-types.ts";
import type { OpenAIFormatTool } from "./mcp-meta-tools.ts";
import { buildToolsAndPromptForThread, executeTool } from "./mcp-meta-tools.ts";
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

/** Chat history for OpenAI-style API: role + content (string). For tool round: assistant has content + tool_calls, then role "tool" messages. */
type ChatTurn = { role: "user" | "assistant" | "system"; content: string };
type AssistantTurnWithTools = {
  role: "assistant";
  content: string | null;
  tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }>;
};
type ToolTurn = { role: "tool"; tool_call_id: string; content: string };
type LlmMessage = ChatTurn | AssistantTurnWithTools | ToolTurn;

function isAssistantWithTools(m: LlmMessage): m is AssistantTurnWithTools {
  return m.role === "assistant" && "tool_calls" in m && Array.isArray((m as AssistantTurnWithTools).tool_calls);
}

function messageToTurn(m: Message): ChatTurn | null {
  const text = m.content
    .filter((c): c is TextContent => c.type === "text")
    .map((c) => c.text)
    .join("");
  return { role: m.role as "user" | "assistant" | "system", content: text };
}

function messageToLlmHistoryTurns(m: Message): LlmMessage[] {
  if (m.role !== "assistant") {
    return [messageToTurn(m)].filter(Boolean) as LlmMessage[];
  }

  const text = m.content
    .filter((c): c is TextContent => c.type === "text")
    .map((c) => c.text)
    .join("");
  const toolCalls = m.content.filter((c): c is MessageContent & { type: "tool-call" } => c.type === "tool-call");
  const toolResults = m.content.filter((c): c is MessageContent & { type: "tool-result" } => c.type === "tool-result");

  if (toolCalls.length === 0) {
    return [{ role: "assistant", content: text }];
  }

  const assistantTurn: AssistantTurnWithTools = {
    role: "assistant",
    content: text || null,
    tool_calls: toolCalls.map((tc) => ({
      id: tc.callId,
      type: "function" as const,
      function: { name: tc.name, arguments: tc.arguments },
    })),
  };
  const toolTurns: ToolTurn[] = toolResults.map((tr) => ({
    role: "tool",
    tool_call_id: tr.callId,
    content: tr.result,
  }));
  return [assistantTurn, ...toolTurns];
}

export type ContextConfiguration = {
  systemPromptText?: string;
  tools: OpenAIFormatTool[];
};

export type DerivedContext = {
  messages: LlmMessage[];
  tools: OpenAIFormatTool[];
};

const META_TOOL_NAME_SET = new Set<string>([
  "list_mcp_servers",
  "get_mcp_tools",
  "load_tool",
]);

/**
 * Pure function: derive runtime LLM context from messages + static/dynamic config + current time.
 * Deduplicates tools by function name and always prepends system prompt when provided.
 */
export function deriveContext(messages: LlmMessage[], config: ContextConfiguration, _time: number): DerivedContext {
  const dedupedToolByName = new Map<string, OpenAIFormatTool>();
  for (const tool of config.tools) {
    const name = tool.function?.name;
    if (!name || dedupedToolByName.has(name)) continue;
    dedupedToolByName.set(name, tool);
  }

  const toolResultByCallId = new Map<string, string>();
  const loadToolCallIds: string[] = [];
  for (const m of messages) {
    if (m.role === "tool") {
      toolResultByCallId.set(m.tool_call_id, m.content);
      continue;
    }
    if (isAssistantWithTools(m)) {
      for (const tc of m.tool_calls ?? []) {
        if (tc.function.name === "load_tool") loadToolCallIds.push(tc.id);
      }
    }
  }
  const loadedToolNames = new Set<string>();
  for (const callId of loadToolCallIds) {
    const raw = toolResultByCallId.get(callId);
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as { result?: string; loadedToolName?: string };
      if (parsed.result === "success" && typeof parsed.loadedToolName === "string" && parsed.loadedToolName.trim()) {
        loadedToolNames.add(parsed.loadedToolName);
      }
    } catch {
      /* ignore malformed tool result */
    }
  }

  const selectedTools = [...dedupedToolByName.values()].filter((tool) => {
    const name = tool.function.name;
    return META_TOOL_NAME_SET.has(name) || loadedToolNames.has(name);
  });

  const baseMessages = [...messages];
  const hasInjectedSystemAtHead =
    config.systemPromptText != null &&
    baseMessages[0]?.role === "system" &&
    baseMessages[0].content === config.systemPromptText;
  const derivedMessages: LlmMessage[] =
    config.systemPromptText && !hasInjectedSystemAtHead
      ? [{ role: "system", content: config.systemPromptText }, ...baseMessages]
      : baseMessages;
  return {
    messages: derivedMessages,
    tools: selectedTools,
  };
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

/** Result of streaming call when tools are used: accumulated content and tool_calls from stream. */
export type CallLlmStreamResult = {
  content: string;
  toolCalls: Array<{ id: string; name: string; arguments: string }>;
};

/** Streaming: POST with stream: true, invoke onChunk for each text delta, accumulate tool_calls, return full result. */
export async function callLlmStream(
  provider: LLMProvider,
  modelId: string,
  turns: LlmMessage[],
  opts: {
    signal?: AbortSignal;
    onChunk: (text: string) => void;
    tools?: OpenAIFormatTool[];
  }
): Promise<CallLlmStreamResult> {
  const base = provider.baseUrl.replace(/\/$/, "");
  const url = `${base}/chat/completions`;
  const body: Record<string, unknown> = {
    model: modelId,
    messages: turns,
    stream: true,
  };
  if (opts.tools != null && opts.tools.length > 0) {
    body.tools = opts.tools;
    body.tool_choice = "auto";
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
  const contentParts: string[] = [];
  const toolCallsAccum: Array<{ id: string; name: string; arguments: string }> = [];
  const toolCallByIndex = new Map<number, { id: string; name: string; arguments: string }>();

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
          const j = JSON.parse(raw) as {
            choices?: Array<{
              delta?: {
                content?: string;
                tool_calls?: Array<{
                  index?: number;
                  id?: string | null;
                  type?: string | null;
                  name?: string | null;
                  arguments?: string | null;
                  function?: { name?: string; arguments?: string };
                }>;
              };
            }>;
          };
          const delta = j.choices?.[0]?.delta;
          if (!delta) continue;
          if (typeof delta.content === "string" && delta.content) {
            contentParts.push(delta.content);
            opts.onChunk(delta.content);
          }
          const tcs = delta.tool_calls;
          if (Array.isArray(tcs)) {
            for (const tc of tcs) {
              const idx = tc.index ?? 0;
              const cur = toolCallByIndex.get(idx) ?? { id: "", name: "", arguments: "" };
              if (tc.id != null && tc.id !== "") cur.id = tc.id;
              const fn = tc.function;
              if (fn?.name != null && fn.name !== "") cur.name = fn.name;
              else if (tc.name != null && tc.name !== "") cur.name = tc.name;
              const arg = fn?.arguments ?? tc.arguments;
              if (arg != null) cur.arguments += arg;
              toolCallByIndex.set(idx, cur);
            }
          }
        } catch {
          /* skip invalid JSON */
        }
      }
    }
  }

  const indices = [...toolCallByIndex.keys()].sort((a, b) => a - b);
  for (const i of indices) {
    const cur = toolCallByIndex.get(i)!;
    if (cur.id && cur.name) toolCallsAccum.push({ id: cur.id, name: cur.name, arguments: cur.arguments });
  }

  return {
    content: contentParts.join(""),
    toolCalls: toolCallsAccum,
  };
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
 * Run messages.send: save user message, call LLM (streaming), handle tool_calls loop, save assistant message, emit Changes.
 * Uses tempMessageId for the stream; stream.done carries the final message from the backend.
 * Calls onStreamStarted (if provided) after emitting stream.status "streaming", so the client can ack the request without waiting for the full reply.
 * Tool loop has no fixed round cap; it stops when model emits no tool call, or when user sends stream.cancel.
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
  let messagesForApi: LlmMessage[] = threadMessages.flatMap((m) => messageToLlmHistoryTurns(m));

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

  const assistantContent: MessageContent[] = [];

  try {
    while (true) {
      const toolsAndPrompt = await buildToolsAndPromptForThread(state, threadId);
      const ctx = deriveContext(messagesForApi, toolsAndPrompt, Date.now());
      const result = await callLlmStream(pm.provider, pm.modelId, ctx.messages, {
        signal: controller.signal,
        onChunk(text) {
          const chunk: StreamChunk = { type: "text", text };
          applyAndBroadcast({ kind: "stream.chunk", payload: { messageId: tempMessageId, threadId, chunk } });
        },
        tools: ctx.tools,
      });

      if (result.content) {
        assistantContent.push({ type: "text", text: result.content });
      }

      if (result.toolCalls.length === 0) break;

      const toolResults: string[] = [];
      for (const tc of result.toolCalls) {
        await applyAndBroadcast({
          kind: "stream.chunk",
          payload: {
            messageId: tempMessageId,
            threadId,
            chunk: {
              type: "tool-call",
              callId: tc.id,
              name: tc.name,
              arguments: tc.arguments,
            },
          },
        });
        assistantContent.push({
          type: "tool-call",
          callId: tc.id,
          name: tc.name,
          arguments: tc.arguments,
        });
        const toolResult = await executeTool(tc.name, tc.arguments, state, threadId);
        toolResults.push(toolResult);
        await applyAndBroadcast({
          kind: "stream.chunk",
          payload: {
            messageId: tempMessageId,
            threadId,
            chunk: {
              type: "tool-result",
              callId: tc.id,
              result: toolResult,
            },
          },
        });
        assistantContent.push({
          type: "tool-result",
          callId: tc.id,
          result: toolResult,
        });
      }

      const assistantTurn: AssistantTurnWithTools = {
        role: "assistant",
        content: result.content || null,
        tool_calls: result.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function" as const,
          function: { name: tc.name, arguments: tc.arguments },
        })),
      };
      const toolTurns: ToolTurn[] = result.toolCalls.map((tc, i) => ({
        role: "tool" as const,
        tool_call_id: tc.id,
        content: toolResults[i],
      }));

      messagesForApi = [...messagesForApi, assistantTurn, ...toolTurns];
    }
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

  if (assistantContent.length === 0) {
    assistantContent.push({ type: "text", text: "" });
  }

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
