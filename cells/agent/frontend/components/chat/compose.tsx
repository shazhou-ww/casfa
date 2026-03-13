import SendIcon from "@mui/icons-material/Send";
import PauseCircleOutlineIcon from "@mui/icons-material/PauseCircleOutline";
import { Box, Button, CircularProgress, MenuItem, TextField, Typography } from "@mui/material";
import { useCallback, useEffect, useState } from "react";
import type { MessageContent } from "../../lib/model-types.ts";
import { useAgentStore } from "../../stores/agent-store.ts";

type ModelOption = {
  id: string;
  label: string;
};

type Props = {
  threadId: string;
  modelId: string | null;
  modelOptions: ModelOption[];
  activeStreamMessageId: string | null;
};

export function Compose({
  threadId,
  modelId,
  modelOptions,
  activeStreamMessageId,
}: Props) {
  const [input, setInput] = useState("");
  const [selectedModelId, setSelectedModelId] = useState<string>(modelId ?? "");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sendMessage = useAgentStore((s) => s.sendMessage);
  const cancelStream = useAgentStore((s) => s.cancelStream);
  const isReActLoopRunning = activeStreamMessageId != null;

  useEffect(() => {
    setSelectedModelId((prev) => {
      if (prev && modelOptions.some((m) => m.id === prev)) return prev;
      return modelId ?? "";
    });
  }, [modelId, modelOptions]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || sending || isReActLoopRunning) return;
    if (!selectedModelId) {
      setError("Configure a provider and model in Settings first.");
      return;
    }
    setInput("");
    setError(null);
    setSending(true);
    try {
      const content: MessageContent[] = [{ type: "text", text }];
      await sendMessage(threadId, content, selectedModelId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to send");
    } finally {
      setSending(false);
    }
  }, [input, sending, isReActLoopRunning, selectedModelId, threadId, sendMessage]);

  const onActionClick = useCallback(() => {
    if (isReActLoopRunning) {
      if (activeStreamMessageId) cancelStream(activeStreamMessageId);
      return;
    }
    send();
  }, [isReActLoopRunning, activeStreamMessageId, cancelStream, send]);

  return (
    <Box sx={{ p: 1, borderTop: 1, borderColor: "divider", bgcolor: "background.paper" }}>
      {error && (
        <Typography variant="caption" color="error" sx={{ display: "block", mb: 0.5 }}>
          {error}
        </Typography>
      )}
      <Box display="flex" gap={1} alignItems="flex-end">
        <TextField
          select
          size="small"
          label="Model"
          sx={{ minWidth: 220 }}
          value={selectedModelId}
          onChange={(e) => setSelectedModelId(e.target.value)}
          disabled={sending || isReActLoopRunning || modelOptions.length === 0}
        >
          {modelOptions.map((option) => (
            <MenuItem key={option.id} value={option.id}>
              {option.label}
            </MenuItem>
          ))}
        </TextField>
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
          disabled={sending || isReActLoopRunning}
        />
        <Button
          variant="contained"
          color={isReActLoopRunning ? "warning" : "primary"}
          endIcon={
            isReActLoopRunning
              ? <PauseCircleOutlineIcon />
              : (sending ? <CircularProgress size={16} color="inherit" /> : <SendIcon />)
          }
          onClick={onActionClick}
          disabled={isReActLoopRunning ? activeStreamMessageId == null : (sending || !input.trim())}
        >
          {isReActLoopRunning ? "Pause" : "Send"}
        </Button>
      </Box>
    </Box>
  );
}
