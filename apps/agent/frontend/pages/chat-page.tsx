import { Box, Typography } from "@mui/material";
import { useCallback, useEffect, useMemo } from "react";
import { useAgentStore } from "../stores/agent-store.ts";
import { MessageList } from "../components/chat/message-list.tsx";
import { Compose } from "../components/chat/compose.tsx";
import { ThreadLoadedScenarios } from "../components/chat/thread-loaded-scenarios.tsx";
import type { Message } from "../lib/api.ts";

function normalizeMessageContent(content: Message["content"]): Message["content"] {
  return content.flatMap((part) => {
    if (part.type === "text") return [part];
    if (part.type === "tool-call") return [part];
    if (part.type === "tool-result") return [part];

    const raw = part as unknown as Record<string, unknown>;
    if (raw.type === "tool_call") {
      return [{
        type: "tool-call" as const,
        callId: typeof raw.callId === "string" ? raw.callId : "",
        name: typeof raw.name === "string" ? raw.name : "",
        arguments: typeof raw.arguments === "string" ? raw.arguments : "",
      }];
    }
    if (raw.type === "tool_result") {
      return [{
        type: "tool-result" as const,
        callId: typeof raw.callId === "string" ? raw.callId : "",
        result: typeof raw.result === "string" ? raw.result : "",
      }];
    }
    return [];
  });
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
  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
  const modelId = lastAssistant?.modelId ?? providers[0]?.models[0]?.id ?? null;
  const provider = modelId
    ? providers.find((p) => p.models.some((m) => m.id === modelId)) ?? providers[0] ?? null
    : providers[0] ?? null;

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
            messages={displayMessages}
            provider={provider}
            modelId={modelId}
          />
        </>
      )}
    </Box>
  );
}
