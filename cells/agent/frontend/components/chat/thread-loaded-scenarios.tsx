/**
 * Placeholder: MCP is now discovered via gateway tools.
 */
import { Box, Typography } from "@mui/material";

type Props = {
  threadId: string;
  messages: unknown[];
};

export function ThreadLoadedScenarios({ threadId: _threadId, messages: _messages }: Props) {
  return (
    <Box sx={{ borderBottom: 1, borderColor: "divider", px: 1, py: 0.5, bgcolor: "action.hover" }}>
      <Typography variant="caption" color="text.secondary">
        MCP: use list_servers, search_servers, get_tools, load_tools
      </Typography>
    </Box>
  );
}
