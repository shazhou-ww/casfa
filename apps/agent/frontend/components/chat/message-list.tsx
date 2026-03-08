import { Box, Paper, Typography } from "@mui/material";
import type { Message } from "../../lib/api.ts";

function contentToText(content: Message["content"]): string {
  return content
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("");
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
          <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
            {contentToText(m.content)}
          </Typography>
        </Paper>
      ))}
    </Box>
  );
}
