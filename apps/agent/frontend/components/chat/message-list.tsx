import { Box, Paper, Typography } from "@mui/material";
import type { Message, MessageContentPart } from "../../lib/api.ts";

function ContentBlock({ part }: { part: MessageContentPart }) {
  if (part.type === "text") {
    if (!part.text.trim()) return null;
    return (
      <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
        {part.text}
      </Typography>
    );
  }
  if (part.type === "tool-call") {
    const argsPreview =
      part.arguments.length > 60 ? part.arguments.slice(0, 60) + "…" : part.arguments;
    return (
      <Typography variant="caption" component="div" sx={{ mt: 0.5, opacity: 0.85 }}>
        <strong>Tool:</strong> {part.name}({argsPreview})
      </Typography>
    );
  }
  if (part.type === "tool-result") {
    const preview =
      part.result.length > 500 ? part.result.slice(0, 500) + "…" : part.result;
    return (
      <Box
        component="pre"
        sx={{
          mt: 0.5,
          p: 1,
          bgcolor: "action.hover",
          borderRadius: 1,
          fontSize: "0.75rem",
          overflow: "auto",
          maxHeight: 200,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {preview}
      </Box>
    );
  }
  return null;
}

export function MessageList({ messages }: { messages: Message[] }) {
  if (messages.length === 0) {
    return (
      <Box flex={1} display="flex" alignItems="center" justifyContent="center" p={2}>
        <Typography color="text.secondary">No messages yet. Send one below.</Typography>
      </Box>
    );
  }
  return (
    <Box flex={1} overflow="auto" display="flex" flexDirection="column" gap={1} p={2}>
      {messages.map((m) => (
        <Paper
          key={m.messageId}
          variant="outlined"
          sx={{
            p: 1.5,
            alignSelf: m.role === "user" ? "flex-end" : "flex-start",
            maxWidth: "85%",
            bgcolor: m.role === "user" ? "primary.main" : "background.paper",
            color: m.role === "user" ? "primary.contrastText" : "text.primary",
          }}
        >
          <Typography variant="caption" sx={{ opacity: 0.8, display: "block", mb: 0.5 }}>
            {m.role}
          </Typography>
          {m.content.map((part, i) => (
            <ContentBlock key={i} part={part} />
          ))}
        </Paper>
      ))}
    </Box>
  );
}
