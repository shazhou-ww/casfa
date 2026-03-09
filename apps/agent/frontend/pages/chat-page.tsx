import { Box, Typography } from "@mui/material";
import { useCallback, useEffect, useMemo } from "react";
import { useAgentStore } from "../stores/agent-store.ts";
import { MessageList } from "../components/chat/message-list.tsx";
import { Compose } from "../components/chat/compose.tsx";
import type { Message } from "../lib/api.ts";

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
    const list = [...messages];
    for (const s of streams) {
      const text = s.chunks
        .filter((c): c is { type: "text"; text: string } => c.type === "text")
        .map((c) => c.text)
        .join("");
      list.push({
        messageId: s.messageId,
        threadId: s.threadId,
        role: "assistant",
        content: [{ type: "text", text }],
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
