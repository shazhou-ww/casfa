import { Box, Typography } from "@mui/material";
import { useCallback, useEffect, useMemo } from "react";
import { useAgentStore } from "../stores/agent-store.ts";
import { MessageList } from "../components/chat/message-list.tsx";
import { Compose } from "../components/chat/compose.tsx";
import { ThreadLoadedScenarios } from "../components/chat/thread-loaded-scenarios.tsx";
import type { Message } from "../lib/api.ts";

function normalizeMessageContent(content: Message["content"]): Message["content"] {
  const normalized: Message["content"] = [];
  for (const part of content) {
    if (part.type === "text") {
      normalized.push(part);
      continue;
    }
    if (part.type === "tool-call") {
      normalized.push(part);
      continue;
    }
    if (part.type === "tool-result") {
      normalized.push(part);
      continue;
    }

    const raw = part as unknown as Record<string, unknown>;
    if (raw.type === "tool_call") {
      normalized.push({
        type: "tool-call" as const,
        callId: typeof raw.callId === "string" ? raw.callId : "",
        name: typeof raw.name === "string" ? raw.name : "",
        arguments: typeof raw.arguments === "string" ? raw.arguments : "",
      });
      continue;
    }
    if (raw.type === "tool_result") {
      normalized.push({
        type: "tool-result" as const,
        callId: typeof raw.callId === "string" ? raw.callId : "",
        result: typeof raw.result === "string" ? raw.result : "",
      });
      continue;
    }
  }
  return normalized;
}

export function ChatPage() {
  const currentThreadId = useAgentStore((s) => s.currentThreadId);
  const messagesByThread = useAgentStore((s) => s.messagesByThread);
  const streamByMessageId = useAgentStore((s) => s.streamByMessageId);
  const fetchMessages = useAgentStore((s) => s.fetchMessages);
  const getLlmProviders = useAgentStore((s) => s.getLlmProviders);
  const threads = useAgentStore((s) => s.threads);
  const setCurrentThreadId = useAgentStore((s) => s.setCurrentThreadId);

  const messages = currentThreadId ? messagesByThread[currentThreadId] ?? [] : [];
  const streams = currentThreadId
    ? Object.values(streamByMessageId).filter((s) => s.threadId === currentThreadId)
    : [];
  const activeStream = useMemo(() => {
    const running = streams
      .filter((s) => s.status === "waiting_agent" || s.status === "streaming")
      .sort((a, b) => b.startedAt - a.startedAt);
    return running[0] ?? null;
  }, [streams]);
  const displayMessages: Message[] = useMemo(() => {
    const list = messages.map((m) => ({
      ...m,
      content: normalizeMessageContent(m.content as Message["content"]),
    }));
    for (const s of streams) {
      const content: Message["content"] = [];
      let textBuffer = "";
      for (const c of s.chunks) {
        if (c.type === "text") {
          if (c.text) textBuffer += c.text;
          continue;
        }
        if (c.type === "tool-call") {
          if (textBuffer) {
            content.push({ type: "text", text: textBuffer });
            textBuffer = "";
          }
          content.push({
            type: "tool-call",
            callId: c.callId ?? "",
            name: c.name ?? "",
            arguments: c.arguments ?? "",
          });
          continue;
        }
        if (c.type === "tool-result") {
          if (textBuffer) {
            content.push({ type: "text", text: textBuffer });
            textBuffer = "";
          }
          content.push({
            type: "tool-result",
            callId: c.callId ?? "",
            result: c.result ?? "",
          });
          continue;
        }
      }
      if (textBuffer) {
        content.push({ type: "text", text: textBuffer });
      }
      if (content.length === 0) {
        content.push({ type: "text", text: "" });
      }
      list.push({
        messageId: s.messageId,
        threadId: s.threadId,
        role: "assistant",
        content,
        createdAt: s.startedAt,
      });
    }
    return list.sort((a, b) => a.createdAt - b.createdAt);
  }, [messages, streams]);

  const providers = getLlmProviders();
  const modelOptions = useMemo(
    () =>
      providers.flatMap((p) =>
        p.models.map((m) => ({
          id: m.id,
          label: `${p.name ?? p.id} / ${m.name ?? m.id}`,
        }))
      ),
    [providers]
  );
  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
  const modelId = lastAssistant?.modelId ?? providers[0]?.models[0]?.id ?? null;

  useEffect(() => {
    if (currentThreadId) fetchMessages(currentThreadId);
  }, [currentThreadId, fetchMessages]);

  const selectFirstThread = useCallback(() => {
    if (threads.length > 0 && !currentThreadId) setCurrentThreadId(threads[0].threadId);
  }, [threads, currentThreadId, setCurrentThreadId]);

  useEffect(() => {
    selectFirstThread();
  }, [selectFirstThread]);

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {!currentThreadId ? (
        <Box flex={1} display="flex" alignItems="center" justifyContent="center" p={2}>
          <Typography color="text.secondary">
            Select a thread or create one in the sidebar to start chatting.
          </Typography>
        </Box>
      ) : (
        <>
          <ThreadLoadedScenarios threadId={currentThreadId} messages={messages} />
          <MessageList messages={displayMessages} />
          <Compose
            threadId={currentThreadId}
            modelId={modelId}
            modelOptions={modelOptions}
            activeStreamMessageId={activeStream?.messageId ?? null}
          />
        </>
      )}
    </Box>
  );
}
