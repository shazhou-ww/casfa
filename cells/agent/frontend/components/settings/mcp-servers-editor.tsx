import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import LogoutIcon from "@mui/icons-material/Logout";
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  Radio,
  RadioGroup,
  TextField,
  Typography,
} from "@mui/material";
import { useCallback, useEffect, useRef, useState } from "react";
import { discoverCapabilities, MCPAuthRequiredError } from "../../lib/mcp-client.ts";
import { discoverFrom401Response, discoverFromConfig, startOAuth } from "../../lib/mcp-oauth-flow.ts";
import { hasMCPToken, removeMCPToken } from "../../lib/mcp-oauth-tokens.ts";
import type { MCPServerConfig } from "../../lib/mcp-types.ts";
import { useAgentStore } from "../../stores/agent-store.ts";

function defaultServer(): MCPServerConfig {
  return {
    id: `mcp_${Date.now()}`,
    name: "",
    transport: "http",
    url: "",
    auth: "none",
  };
}

type Props = {
  open: boolean;
  onClose: () => void;
  servers: MCPServerConfig[];
  onSave: (servers: MCPServerConfig[]) => Promise<void>;
};

export function McpServersEditor({ open, onClose, servers, onSave }: Props) {
  const [list, setList] = useState<MCPServerConfig[]>(() => (servers.length ? [...servers] : [defaultServer()]));
  const [saving, setSaving] = useState(false);
  const [tokenStatus, setTokenStatus] = useState<Record<string, boolean>>({});
  const [discoveringId, setDiscoveringId] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const initialServersRef = useRef(servers);
  const prevOpenRef = useRef(open);
  const setMcpDiscovery = useAgentStore((s) => s.setMcpDiscovery);

  if (open && initialServersRef.current !== servers) initialServersRef.current = servers;

  useEffect(() => {
    if (!open) return;
    const justOpened = open && !prevOpenRef.current;
    prevOpenRef.current = open;
    if (justOpened) {
      setList(servers.length ? [...servers] : [defaultServer()]);
      setAuthError(null);
      const oauthIds = servers.filter((s) => s.auth === "oauth2").map((s) => s.id);
      Promise.all(oauthIds.map((id) => hasMCPToken(id))).then((results) => {
        setTokenStatus(Object.fromEntries(oauthIds.map((id, i) => [id, results[i]])));
      });
    }
  }, [open, servers]);

  const addServer = useCallback(() => {
    setList((prev) => [...prev, defaultServer()]);
  }, []);

  const removeServer = useCallback((index: number) => {
    setList((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const updateServer = useCallback((index: number, patch: Partial<MCPServerConfig>) => {
    setList((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  }, []);

  const handleLogin = useCallback(
    async (config: MCPServerConfig) => {
      setAuthError(null);
      try {
        const discovery = await discoverFromConfig(config);
        await startOAuth(config, discovery, { usePopup: true });
        const hasToken = await hasMCPToken(config.id);
        setTokenStatus((prev) => ({ ...prev, [config.id]: hasToken }));
      } catch (e) {
        setAuthError(e instanceof Error ? e.message : String(e));
      }
    },
    []
  );

  const handleLogout = useCallback(async (serverId: string) => {
    await removeMCPToken(serverId);
    setTokenStatus((prev) => ({ ...prev, [serverId]: false }));
    setMcpDiscovery(serverId, null);
  }, [setMcpDiscovery]);

  const runDiscovery = useCallback(
    async (config: MCPServerConfig) => {
      if (!config.url?.trim()) return;
      setDiscoveringId(config.id);
      setMcpDiscovery(config.id, null);
      try {
        const cap = await discoverCapabilities(config);
        setMcpDiscovery(config.id, {
          serverId: config.id,
          tools: cap.tools,
          prompts: cap.prompts,
          resources: cap.resources,
          updatedAt: Date.now(),
        });
        setAuthError(null);
      } catch (e) {
        if (e instanceof MCPAuthRequiredError) {
          try {
            const discovery = await discoverFrom401Response(e.response, e.serverUrl);
            await startOAuth({ ...config, id: e.serverId }, discovery, { usePopup: true });
            setTokenStatus((prev) => ({ ...prev, [e.serverId]: true }));
            await runDiscovery(config);
          } catch (err) {
            setAuthError(err instanceof Error ? err.message : String(err));
          }
        } else {
          setMcpDiscovery(config.id, {
            serverId: config.id,
            tools: [],
            prompts: [],
            resources: [],
            error: e instanceof Error ? e.message : String(e),
            updatedAt: Date.now(),
          });
        }
      } finally {
        setDiscoveringId(null);
      }
    },
    [setMcpDiscovery]
  );

  const handleSave = useCallback(async () => {
    const toSave = list.filter((s) => s.name.trim() && (s.transport !== "http" || (s.url && s.url.trim())));
    if (!toSave.length) return;
    setSaving(true);
    setAuthError(null);
    try {
      await onSave(toSave);
      for (const config of toSave) {
        if (config.transport === "http" && config.url?.trim()) await runDiscovery(config);
      }
      onClose();
    } finally {
      setSaving(false);
    }
  }, [list, onSave, onClose, runDiscovery]);

  const discovery = useAgentStore((s) => s.mcpDiscoveryByServerId);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>MCP servers</DialogTitle>
      <DialogContent>
        <Box display="flex" flexDirection="column" gap={2} pt={1}>
          {authError && (
            <Typography variant="body2" color="error">
              {authError}
            </Typography>
          )}
          {list.map((server, si) => {
            const disc = discovery[server.id];
            const isDiscovering = discoveringId === server.id;
            return (
              <Box
                key={server.id}
                sx={{
                  p: 2,
                  border: 1,
                  borderColor: "divider",
                  borderRadius: 1,
                }}
              >
                <Box display="flex" alignItems="center" justifyContent="space-between" mb={1}>
                  <Typography variant="subtitle2">Server {si + 1}</Typography>
                  <IconButton size="small" onClick={() => removeServer(si)} aria-label="Remove server">
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Box>
                <TextField
                  label="Name"
                  size="small"
                  fullWidth
                  margin="dense"
                  required
                  value={server.name}
                  onChange={(e) => updateServer(si, { name: e.target.value })}
                  placeholder="e.g. My MCP"
                />
                <RadioGroup row value={server.transport} onChange={(_, v) => updateServer(si, { transport: v as "http" | "stdio" })}>
                  <FormControlLabel value="http" control={<Radio size="small" />} label="HTTP" />
                  <FormControlLabel value="stdio" control={<Radio size="small" />} label="Stdio" disabled />
                </RadioGroup>
                {server.transport === "http" && (
                  <TextField
                    label="URL"
                    size="small"
                    fullWidth
                    margin="dense"
                    required
                    value={server.url ?? ""}
                    onChange={(e) => updateServer(si, { url: e.target.value })}
                    placeholder="https://mcp.example.com/mcp"
                  />
                )}
                <RadioGroup row value={server.auth} onChange={(_, v) => updateServer(si, { auth: v as "none" | "oauth2" })}>
                  <FormControlLabel value="none" control={<Radio size="small" />} label="None" />
                  <FormControlLabel value="oauth2" control={<Radio size="small" />} label="OAuth 2" />
                </RadioGroup>
                {server.auth === "oauth2" && (
                  <>
                    <TextField
                      label="Client ID (optional)"
                      size="small"
                      fullWidth
                      margin="dense"
                      value={server.oauthClientId ?? ""}
                      onChange={(e) => updateServer(si, { oauthClientId: e.target.value || undefined })}
                      placeholder="Pre-registered client_id"
                    />
                    <TextField
                      label="Client metadata URL (optional)"
                      size="small"
                      fullWidth
                      margin="dense"
                      value={server.oauthClientMetadataUrl ?? ""}
                      onChange={(e) => updateServer(si, { oauthClientMetadataUrl: e.target.value || undefined })}
                      placeholder="https://app.example.com/oauth/client.json"
                    />
                    <Box display="flex" alignItems="center" gap={1} mt={1}>
                      {tokenStatus[server.id] ? (
                        <Button
                          size="small"
                          startIcon={<LogoutIcon />}
                          onClick={() => handleLogout(server.id)}
                          color="secondary"
                        >
                          Logout
                        </Button>
                      ) : (
                        <Button size="small" variant="outlined" onClick={() => handleLogin(server)} disabled={!server.url?.trim()}>
                          Login
                        </Button>
                      )}
                    </Box>
                  </>
                )}
                {disc && (
                  <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: "block" }}>
                    {disc.error
                      ? `Error: ${disc.error}`
                      : `${disc.tools.length} tools, ${disc.prompts.length} prompts, ${disc.resources.length} resources`}
                  </Typography>
                )}
                {server.transport === "http" && server.url?.trim() && (
                  <Button
                    size="small"
                    onClick={() => runDiscovery(server)}
                    disabled={isDiscovering}
                    sx={{ mt: 1 }}
                  >
                    {isDiscovering ? "Discovering…" : "Discover capabilities"}
                  </Button>
                )}
              </Box>
            );
          })}
          <Button startIcon={<AddIcon />} onClick={addServer}>
            Add server
          </Button>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={handleSave} disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
