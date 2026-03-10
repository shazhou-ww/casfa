/**
 * Placeholder UI: show loaded MCP scenarios for the current thread and send load/unload as user tool-call messages.
 */
import AddCircleOutlineIcon from "@mui/icons-material/AddCircleOutline";
import RemoveCircleOutlineIcon from "@mui/icons-material/RemoveCircleOutline";
import { Box, Button, Chip, Collapse, TextField, Typography } from "@mui/material";
import { useCallback, useState } from "react";
import { deriveLoadedScenarios } from "../../lib/derive-loaded-scenarios.ts";
import type { MessageContent } from "../../lib/model-types.ts";
import { MCP_SERVERS_SETTINGS_KEY, parseMcpServers } from "../../lib/mcp-types.ts";
import { useAgentStore } from "../../stores/agent-store.ts";

type Props = {
  threadId: string;
  messages: Message[];
};

export function ThreadLoadedScenarios({ threadId, messages }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [serverId, setServerId] = useState("");
  const [scenarioId, setScenarioId] = useState("");
  const [sending, setSending] = useState(false);
  const sendMessage = useAgentStore((s) => s.sendMessage);
  const settings = useAgentStore((s) => s.settings);
  const mcpServers = parseMcpServers(settings[MCP_SERVERS_SETTINGS_KEY]);
  const loaded = deriveLoadedScenarios(threadId, messages, mcpServers);
  const loadedList = [...loaded].sort();

  const sendLoad = useCallback(async () => {
    const s = serverId.trim();
    const sc = scenarioId.trim();
    if (!s || !sc || sending) return;
    setSending(true);
    try {
      const callId = crypto.randomUUID();
      const content: MessageContent[] = [
        { type: "tool-call", callId, name: "load_scenario", arguments: JSON.stringify({ serverId: s, scenarioId: sc }) },
        { type: "tool-result", callId, result: "ok" },
      ];
      await sendMessage(threadId, content);
      setServerId("");
      setScenarioId("");
    } finally {
      setSending(false);
    }
  }, [threadId, serverId, scenarioId, sending, sendMessage]);

  const sendUnload = useCallback(
    async (key: string) => {
      const idx = key.indexOf("#");
      const s = idx >= 0 ? key.slice(0, idx) : key;
      const sc = idx >= 0 ? key.slice(idx + 1) : "";
      if (!s || !sc || sending) return;
      setSending(true);
      try {
        const callId = crypto.randomUUID();
        const content: MessageContent[] = [
          { type: "tool-call", callId, name: "unload_scenario", arguments: JSON.stringify({ serverId: s, scenarioId: sc }) },
          { type: "tool-result", callId, result: "ok" },
        ];
        await sendMessage(threadId, content);
      } finally {
        setSending(false);
      }
    },
    [threadId, sending, sendMessage]
  );

  return (
    <Box sx={{ borderBottom: 1, borderColor: "divider", px: 1, py: 0.5, bgcolor: "action.hover" }}>
      <Button
        size="small"
        onClick={() => setExpanded((e) => !e)}
        sx={{ textTransform: "none", justifyContent: "flex-start" }}
      >
        <Typography variant="caption" color="text.secondary">
          MCP scenarios: {loadedList.length} loaded
        </Typography>
      </Button>
      <Collapse in={expanded}>
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, alignItems: "center", mb: 1 }}>
          {loadedList.map((key) => (
            <Chip
              key={key}
              label={key}
              size="small"
              onDelete={sending ? undefined : () => sendUnload(key)}
              deleteIcon={<RemoveCircleOutlineIcon />}
            />
          ))}
        </Box>
        <Box sx={{ display: "flex", gap: 1, alignItems: "center", flexWrap: "wrap" }}>
          <TextField
            size="small"
            placeholder="serverId"
            value={serverId}
            onChange={(e) => setServerId(e.target.value)}
            sx={{ width: 120 }}
          />
          <TextField
            size="small"
            placeholder="scenarioId"
            value={scenarioId}
            onChange={(e) => setScenarioId(e.target.value)}
            sx={{ width: 140 }}
          />
          <Button
            size="small"
            startIcon={<AddCircleOutlineIcon />}
            onClick={sendLoad}
            disabled={sending || !serverId.trim() || !scenarioId.trim()}
          >
            Load
          </Button>
        </Box>
      </Collapse>
    </Box>
  );
}
