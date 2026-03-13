import { Box, Button, List, ListItem, ListItemText, Typography } from "@mui/material";
import { useCallback, useEffect, useState } from "react";
import { useAgentStore } from "../stores/agent-store.ts";
import { LLMProvidersEditor } from "../components/settings/llm-providers-editor.tsx";
import { McpServersEditor } from "../components/settings/mcp-servers-editor.tsx";

export function SettingsPage() {
  const fetchSettings = useAgentStore((s) => s.fetchSettings);
  const getLlmProviders = useAgentStore((s) => s.getLlmProviders);
  const getMcpServers = useAgentStore((s) => s.getMcpServers);
  const setSetting = useAgentStore((s) => s.setSetting);
  const setMcpServers = useAgentStore((s) => s.setMcpServers);
  const settingsLoading = useAgentStore((s) => s.settingsLoading);

  const [editorOpen, setEditorOpen] = useState(false);
  const [mcpEditorOpen, setMcpEditorOpen] = useState(false);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const providers = getLlmProviders();

  const handleSaveLlmProviders = useCallback(
    async (next: ReturnType<typeof getLlmProviders>) => {
      await setSetting("llm.providers", next);
    },
    [setSetting]
  );

  const handleSaveMcpServers = useCallback(
    async (next: ReturnType<typeof getMcpServers>) => {
      await setMcpServers(next);
    },
    [setMcpServers]
  );

  const mcpServers = getMcpServers();
  const mcpSummary =
    mcpServers.length === 0
      ? "Not configured"
      : `${mcpServers.length} server(s)`;

  return (
    <Box p={2} maxWidth={640}>
      <Typography variant="h5" gutterBottom>
        Settings
      </Typography>
      {settingsLoading ? (
        <Typography color="text.secondary">Loading…</Typography>
      ) : (
        <List disablePadding>
          <ListItem
            disablePadding
            sx={{ py: 1 }}
            secondaryAction={
              <Button size="small" onClick={() => setEditorOpen(true)}>
                Edit
              </Button>
            }
          >
            <ListItemText
              primary="LLM providers"
              secondary={
                providers.length
                  ? `${providers.length} provider(s), ${providers.reduce((n, p) => n + p.models.length, 0)} model(s)`
                  : "Not configured"
              }
            />
          </ListItem>
          <ListItem
            disablePadding
            sx={{ py: 1 }}
            secondaryAction={
              <Button size="small" onClick={() => setMcpEditorOpen(true)}>
                Edit
              </Button>
            }
          >
            <ListItemText primary="MCP servers" secondary={mcpSummary} />
          </ListItem>
        </List>
      )}
      <LLMProvidersEditor
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        providers={providers}
        onSave={handleSaveLlmProviders}
      />
      <McpServersEditor
        open={mcpEditorOpen}
        onClose={() => setMcpEditorOpen(false)}
        servers={mcpServers}
        onSave={handleSaveMcpServers}
      />
    </Box>
  );
}
