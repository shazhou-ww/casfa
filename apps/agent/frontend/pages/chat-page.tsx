import { Box, Typography } from "@mui/material";
import { useCallback, useEffect } from "react";
import { useAgentStore } from "../stores/agent-store.ts";
import { MessageList } from "../components/chat/message-list.tsx";
import { Compose } from "../components/chat/compose.tsx";

export function ChatPage() {
  const currentThreadId = useAgentStore((s) => s.currentThreadId);
  const messagesByThread = useAgentStore((s) => s.messagesByThread);
  const fetchMessages = useAgentStore((s) => s.fetchMessages);
  const getLlmProviders = useAgentStore((s) => s.getLlmProviders);
  const threads = useAgentStore((s) => s.threads);
  const setCurrentThreadId = useAgentStore((s) => s.setCurrentThreadId);

  const messages = currentThreadId ? messagesByThread[currentThreadId] ?? [] : [];
  const currentThread = threads.find((t) => t.threadId === currentThreadId);
  const providers = getLlmProviders();
  const modelId = currentThread?.modelId ?? providers[0]?.models[0]?.id ?? null;
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
          <MessageList messages={messages} />
          <Compose
            threadId={currentThreadId}
            messages={messages}
            provider={provider}
            modelId={modelId}
          />
        </>
      )}
    </Box>
  );
}
