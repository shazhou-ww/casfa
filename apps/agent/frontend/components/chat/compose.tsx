import SendIcon from "@mui/icons-material/Send";
import { Box, Button, CircularProgress, TextField } from "@mui/material";
import { useCallback, useState } from "react";
import type { Message } from "../../lib/api.ts";
import { useAgentStore } from "../../stores/agent-store.ts";
import { callChatCompletion } from "../../lib/llm-client.ts";
import type { LLMProvider } from "../../stores/agent-store.ts";

type Props = {
  threadId: string;
  messages: Message[];
  provider: LLMProvider | null;
  modelId: string | null;
};

export function Compose({ threadId, messages, provider, modelId }: Props) {
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const appendMessageLocal = useAgentStore((s) => s.appendMessageLocal);
  const createMessage = useAgentStore((s) => s.createMessage);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || sending) return;
    if (!provider || !modelId) {
      setError("Configure a provider and model in Settings first.");
      return;
    }
    setInput("");
    setError(null);
    setSending(true);

    const userContent: Message["content"] = [{ type: "text", text }];
    const userMessage = {
      messageId: `local_${Date.now()}`,
      threadId,
      role: "user" as const,
      content: userContent,
      createdAt: Date.now(),
    };
    appendMessageLocal(threadId, userMessage);
    try {
      await createMessage(threadId, { role: "user", content: userContent });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save message");
      setSending(false);
      return;
    }

    const history = messages
      .concat([userMessage])
      .map((m) => ({
        role: m.role as "user" | "assistant" | "system",
        content: m.content.filter((p): p is { type: "text"; text: string } => p.type === "text").map((p) => p.text).join(""),
      }));

    try {
      const assistantText = await callChatCompletion(provider, modelId, history);
      const assistantContent: Message["content"] = [{ type: "text", text: assistantText }];
      appendMessageLocal(threadId, {
        messageId: `local_${Date.now()}_a`,
        threadId,
        role: "assistant",
        content: assistantContent,
        createdAt: Date.now(),
      });
      await createMessage(threadId, { role: "assistant", content: assistantContent });
    } catch (e) {
      setError(e instanceof Error ? e.message : "LLM request failed");
    } finally {
      setSending(false);
    }
  }, [input, sending, provider, modelId, threadId, messages, appendMessageLocal, createMessage]);

  return (
    <Box sx={{ p: 1, borderTop: 1, borderColor: "divider", bgcolor: "background.paper" }}>
      {error && (
        <Typography variant="caption" color="error" sx={{ display: "block", mb: 0.5 }}>
          {error}
        </Typography>
      )}
      <Box display="flex" gap={1} alignItems="flex-end">
        <TextField
          multiline
          maxRows={4}
          size="small"
          fullWidth
          placeholder="Type a message…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          disabled={sending}
        />
        <Button
          variant="contained"
          endIcon={sending ? <CircularProgress size={16} color="inherit" /> : <SendIcon />}
          onClick={send}
          disabled={sending || !input.trim()}
        >
          Send
        </Button>
      </Box>
    </Box>
  );
}
