import { Box, Button, List, ListItem, ListItemText, Typography } from "@mui/material";
import { useCallback, useEffect, useState } from "react";
import { useAgentStore } from "../stores/agent-store.ts";
import { LLMProvidersEditor } from "../components/settings/llm-providers-editor.tsx";

export function SettingsPage() {
  const fetchSettings = useAgentStore((s) => s.fetchSettings);
  const getLlmProviders = useAgentStore((s) => s.getLlmProviders);
  const setSetting = useAgentStore((s) => s.setSetting);
  const settingsLoading = useAgentStore((s) => s.settingsLoading);

  const [editorOpen, setEditorOpen] = useState(false);

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

  const openGatewayMcpSettings = useCallback(() => {
    const url = new URL("/gateway/", window.location.origin).toString();
    const popup = window.open(url, "gateway-mcp-settings", "width=1200,height=900,scrollbars=yes,resizable=yes");
    if (!popup) {
      window.location.href = url;
      return;
    }
    popup.focus();
  }, []);

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
              <Button size="small" onClick={openGatewayMcpSettings}>
                Open
              </Button>
            }
          >
            <ListItemText primary="MCP servers" secondary="Managed in Gateway" />
          </ListItem>
        </List>
      )}
      <LLMProvidersEditor
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        providers={providers}
        onSave={handleSaveLlmProviders}
      />
    </Box>
  );
}
