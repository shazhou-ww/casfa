import SendIcon from "@mui/icons-material/Send";
import PauseCircleOutlineIcon from "@mui/icons-material/PauseCircleOutline";
import { Box, CircularProgress, IconButton, MenuItem, TextField, Typography } from "@mui/material";
import { useCallback, useEffect, useState } from "react";
import type { MessageContent } from "../../lib/model-types.ts";
import {
  readDefaultModelId,
  readPromptLanguagePreference,
  writeDefaultModelId,
  writePromptLanguagePreference,
} from "../../lib/chat-preferences.ts";
import { parseSystemPromptLanguage, SYSTEM_PROMPT_LANGUAGE_KEY } from "../../lib/prompt-settings.ts";
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
  const [selectedModelId, setSelectedModelId] = useState<string>(modelId ?? readDefaultModelId() ?? "");
  const [selectedPromptLanguage, setSelectedPromptLanguage] = useState<"en" | "zh-CN">(
    readPromptLanguagePreference() ?? "en"
  );
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sendMessage = useAgentStore((s) => s.sendMessage);
  const cancelStream = useAgentStore((s) => s.cancelStream);
  const setSetting = useAgentStore((s) => s.setSetting);
  const settings = useAgentStore((s) => s.settings);
  const isReActLoopRunning = activeStreamMessageId != null;
  const promptLanguageFromSettings = parseSystemPromptLanguage(settings[SYSTEM_PROMPT_LANGUAGE_KEY]);
  const hasPromptLanguageInSettings = Object.prototype.hasOwnProperty.call(settings, SYSTEM_PROMPT_LANGUAGE_KEY);

  useEffect(() => {
    const localModelId = readDefaultModelId();
    setSelectedModelId((prev) => {
      if (prev && modelOptions.some((m) => m.id === prev)) return prev;
      if (localModelId && modelOptions.some((m) => m.id === localModelId)) return localModelId;
      return modelId ?? "";
    });
  }, [modelId, modelOptions]);

  useEffect(() => {
    const localPromptLanguage = readPromptLanguagePreference();
    if (hasPromptLanguageInSettings) {
      setSelectedPromptLanguage(promptLanguageFromSettings);
      return;
    }
    if (localPromptLanguage) {
      setSelectedPromptLanguage(localPromptLanguage);
    }
  }, [hasPromptLanguageInSettings, promptLanguageFromSettings]);

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

  const onPromptLanguageChange = useCallback(
    async (next: string) => {
      if (next !== "en" && next !== "zh-CN") return;
      setSelectedPromptLanguage(next);
      writePromptLanguagePreference(next);
      try {
        await setSetting(SYSTEM_PROMPT_LANGUAGE_KEY, next);
      } catch (e) {
        setSelectedPromptLanguage(promptLanguageFromSettings);
        setError(e instanceof Error ? e.message : "Failed to update prompt language");
      }
    },
    [setSetting, promptLanguageFromSettings]
  );

  return (
    <Box sx={{ p: 1, borderTop: 1, borderColor: "divider", bgcolor: "background.paper" }}>
      {error && (
        <Typography variant="caption" color="error" sx={{ display: "block", mb: 0.5, fontSize: "0.72rem" }}>
          {error}
        </Typography>
      )}
      <Box display="flex" flexDirection="column" gap={0.65}>
        <Box display="flex" alignItems="center" justifyContent="flex-start" gap={0.75}>
          <TextField
            select
            size="small"
            sx={{
              minWidth: 170,
              "& .MuiInputBase-root": { height: 30 },
              "& .MuiInputBase-input": { fontSize: "0.72rem", py: 0.55 },
              "& .MuiOutlinedInput-notchedOutline": { border: "none" },
              "&:hover .MuiOutlinedInput-notchedOutline": { border: "none" },
              "& .Mui-focused .MuiOutlinedInput-notchedOutline": { border: "none" },
            }}
            value={selectedModelId}
            onChange={(e) => {
              const next = e.target.value;
              setSelectedModelId(next);
              writeDefaultModelId(next);
            }}
            disabled={sending || isReActLoopRunning || modelOptions.length === 0}
          >
            {modelOptions.map((option) => (
              <MenuItem key={option.id} value={option.id} sx={{ fontSize: "0.72rem", minHeight: 28 }}>
                {option.label}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            size="small"
            sx={{
              minWidth: 112,
              "& .MuiInputBase-root": { height: 30 },
              "& .MuiInputBase-input": { fontSize: "0.72rem", py: 0.55 },
              "& .MuiOutlinedInput-notchedOutline": { border: "none" },
              "&:hover .MuiOutlinedInput-notchedOutline": { border: "none" },
              "& .Mui-focused .MuiOutlinedInput-notchedOutline": { border: "none" },
            }}
            value={selectedPromptLanguage}
            onChange={(e) => {
              void onPromptLanguageChange(e.target.value);
            }}
          >
            <MenuItem value="en" sx={{ fontSize: "0.72rem", minHeight: 28 }}>
              English
            </MenuItem>
            <MenuItem value="zh-CN" sx={{ fontSize: "0.72rem", minHeight: 28 }}>
              中文
            </MenuItem>
          </TextField>
        </Box>

        <Box sx={{ position: "relative" }}>
          <TextField
            multiline
            maxRows={4}
            size="small"
            fullWidth
            placeholder="Type a message…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            sx={{
              "& .MuiInputBase-input": { fontSize: "0.82rem", lineHeight: 1.35, pr: "2.4rem" },
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            disabled={sending || isReActLoopRunning}
          />
          <IconButton
            size="small"
            color={isReActLoopRunning ? "warning" : "primary"}
            sx={{
              position: "absolute",
              right: 6,
              bottom: 6,
              bgcolor: "transparent",
              border: "none",
              "&:hover": { bgcolor: "transparent" },
            }}
            onClick={onActionClick}
            disabled={isReActLoopRunning ? activeStreamMessageId == null : sending || !input.trim()}
          >
            {isReActLoopRunning ? (
              <PauseCircleOutlineIcon sx={{ fontSize: 16 }} />
            ) : sending ? (
              <CircularProgress size={14} color="inherit" />
            ) : (
              <SendIcon sx={{ fontSize: 16 }} />
            )}
          </IconButton>
        </Box>
      </Box>
    </Box>
  );
}
