import SendIcon from "@mui/icons-material/Send";
import { Box, Button, CircularProgress, TextField, Typography } from "@mui/material";
import { useCallback, useState } from "react";
import type { MessageContent } from "../../lib/model-types.ts";
import type { Message } from "../../lib/api.ts";
import { useAgentStore } from "../../stores/agent-store.ts";
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
  const sendMessage = useAgentStore((s) => s.sendMessage);

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
    try {
      const content: MessageContent[] = [{ type: "text", text }];
      await sendMessage(threadId, content, modelId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to send");
    } finally {
      setSending(false);
    }
  }, [input, sending, provider, modelId, threadId, sendMessage]);

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
