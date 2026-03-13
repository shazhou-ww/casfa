/**
 * Placeholder: MCP is now discovered via list_mcp_servers, get_mcp_tools, get_tool_usage, run_mcp_tool (no load/unload).
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
        MCP: use list_mcp_servers, get_mcp_tools, get_tool_usage, run_mcp_tool
      </Typography>
    </Box>
  );
}
