import LogoutIcon from "@mui/icons-material/Logout";
import SecurityIcon from "@mui/icons-material/Security";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import RefreshIcon from "@mui/icons-material/Refresh";
import AddIcon from "@mui/icons-material/Add";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DoneIcon from "@mui/icons-material/Done";
import {
  Alert,
  AppBar,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Toolbar,
  Tooltip,
  Typography,
} from "@mui/material";
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch, authClient, getCookieUser, redirectToLogin, useCookieAuthCheck } from "./lib/auth";

type ServerItem = {
  id: string;
  name: string;
  url: string;
};

type Status = {
  kind: "info" | "success" | "error";
  message: string;
} | null;

type OAuthStatusItem = {
  serverId: string;
  requiresOAuth: boolean;
  loggedIn: boolean;
};

type Delegate = {
  delegateId: string;
  clientName: string;
  permissions: string[];
  createdAt: number;
  expiresAt: number | null;
};

type NewDelegate = {
  delegateId: string;
  clientName: string;
  accessToken: string;
  refreshToken: string;
  permissions: string[];
  expiresAt: number;
};

async function fetchJson<T>(path: string, init: RequestInit | null = null): Promise<T> {
  const res = await apiFetch(path, init);
  if (!res.ok) {
    throw new Error(`${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

function LoginView() {
  return (
    <Container maxWidth="sm" sx={{ py: 8 }}>
      <Paper variant="outlined" sx={{ p: 4, textAlign: "center" }}>
        <Typography variant="h5" fontWeight={700} gutterBottom>
          Gateway MCP 管理
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          请先登录后管理你的 MCP Server 与工具映射
        </Typography>
        <Button variant="contained" onClick={() => redirectToLogin(window.location.href)}>
          登录
        </Button>
      </Paper>
    </Container>
  );
}

function CreateDelegateDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (token: NewDelegate) => void;
}) {
  const [name, setName] = useState("");
  const [useMcp, setUseMcp] = useState(true);
  const [manageDelegates, setManageDelegates] = useState(false);
  const [ttlHours, setTtlHours] = useState(24);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const submit = useCallback(async () => {
    if (!name.trim()) return;
    setSubmitting(true);
    setError("");
    const permissions: string[] = [];
    if (useMcp) permissions.push("use_mcp");
    if (manageDelegates) permissions.push("manage_delegates");
    try {
      const token = await fetchJson<NewDelegate>("/api/delegates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientName: name.trim(),
          permissions,
          ttl: ttlHours * 3600 * 1000,
        }),
      });
      setName("");
      onCreated(token);
      onClose();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setSubmitting(false);
    }
  }, [manageDelegates, name, onClose, onCreated, ttlHours, useMcp]);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>创建 Delegate</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            label="Client Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            size="small"
            fullWidth
            autoFocus
          />
          <Box>
            <Typography variant="body2" fontWeight={500}>
              Permissions
            </Typography>
            <FormControlLabel
              control={<Checkbox checked={useMcp} onChange={(e) => setUseMcp(e.target.checked)} size="small" />}
              label="use_mcp"
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={manageDelegates}
                  onChange={(e) => setManageDelegates(e.target.checked)}
                  size="small"
                />
              }
              label="manage_delegates"
            />
          </Box>
          <TextField
            label="TTL (hours)"
            type="number"
            size="small"
            sx={{ width: 180 }}
            value={ttlHours}
            onChange={(e) => setTtlHours(Number(e.target.value))}
            inputProps={{ min: 1, max: 24 * 365 }}
          />
          {error ? <Alert severity="error">{error}</Alert> : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>取消</Button>
        <Button variant="contained" disabled={submitting || !name.trim()} onClick={() => void submit()}>
          {submitting ? "创建中..." : "创建"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function TokenDisplay({ token, onDone }: { token: NewDelegate; onDone: () => void }) {
  const [copied, setCopied] = useState<"access" | "refresh" | null>(null);
  const copy = useCallback((text: string, key: "access" | "refresh") => {
    void navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 1800);
  }, []);
  return (
    <Alert severity="success" action={<Button onClick={onDone}>Done</Button>}>
      <Typography variant="subtitle2" sx={{ mb: 1 }}>
        Delegate 已创建：{token.clientName}
      </Typography>
      <Stack spacing={1}>
        <Box>
          <Typography variant="caption">Access Token</Typography>
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
            <Box component="code" sx={{ flex: 1, p: 0.75, bgcolor: "grey.100", borderRadius: 1, fontSize: 11, wordBreak: "break-all" }}>
              {token.accessToken}
            </Box>
            <Tooltip title={copied === "access" ? "Copied" : "Copy"}>
              <IconButton size="small" onClick={() => copy(token.accessToken, "access")}>
                {copied === "access" ? <DoneIcon fontSize="small" /> : <ContentCopyIcon fontSize="small" />}
              </IconButton>
            </Tooltip>
          </Box>
        </Box>
        <Box>
          <Typography variant="caption">Refresh Token</Typography>
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
            <Box component="code" sx={{ flex: 1, p: 0.75, bgcolor: "grey.100", borderRadius: 1, fontSize: 11, wordBreak: "break-all" }}>
              {token.refreshToken}
            </Box>
            <Tooltip title={copied === "refresh" ? "Copied" : "Copy"}>
              <IconButton size="small" onClick={() => copy(token.refreshToken, "refresh")}>
                {copied === "refresh" ? <DoneIcon fontSize="small" /> : <ContentCopyIcon fontSize="small" />}
              </IconButton>
            </Tooltip>
          </Box>
        </Box>
      </Stack>
    </Alert>
  );
}

export function App() {
  const { loading: authLoading, isLoggedIn } = useCookieAuthCheck();
  const user = getCookieUser();
  const [status, setStatus] = useState<Status>(null);
  const [servers, setServers] = useState<ServerItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [delegateLoading, setDelegateLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [oauthStatusMap, setOauthStatusMap] = useState<Record<string, OAuthStatusItem>>({});
  const [delegates, setDelegates] = useState<Delegate[]>([]);
  const [showCreateDelegate, setShowCreateDelegate] = useState(false);
  const [newToken, setNewToken] = useState<NewDelegate | null>(null);
  const [form, setForm] = useState({
    name: "",
    url: "",
  });

  const canSubmit = useMemo(() => {
    return form.name.trim().length > 0 && form.url.trim().length > 0;
  }, [form]);

  const loadServers = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchJson<{ servers: ServerItem[] }>("/api/servers");
      setServers(data.servers);
      const oauthStatus = await fetchJson<{ statuses: OAuthStatusItem[] }>("/api/servers/oauth/statuses");
      const map: Record<string, OAuthStatusItem> = {};
      for (const item of oauthStatus.statuses) {
        map[item.serverId] = item;
      }
      setOauthStatusMap(map);
    } catch (error) {
      setStatus({
        kind: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDelegates = useCallback(async () => {
    setDelegateLoading(true);
    try {
      const data = await fetchJson<Delegate[]>("/api/delegates");
      setDelegates(data);
    } catch (error) {
      setStatus({
        kind: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setDelegateLoading(false);
    }
  }, []);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.get("oauth") === "ok") {
      const serverId = url.searchParams.get("serverId") ?? "";
      setStatus({ kind: "success", message: `OAuth 授权成功${serverId ? `: ${serverId}` : ""}` });
      url.searchParams.delete("oauth");
      url.searchParams.delete("serverId");
      window.history.replaceState({}, "", url.toString());
    }
  }, []);

  useEffect(() => {
    if (!isLoggedIn) return;
    void loadServers();
    void loadDelegates();
  }, [isLoggedIn, loadDelegates, loadServers]);

  const onAddServer = useCallback(async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await fetchJson<{ added: string }>("/api/servers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          url: form.url.trim(),
        }),
      });
      setForm({ name: "", url: "" });
      setStatus({ kind: "success", message: "添加成功" });
      await loadServers();
    } catch (error) {
      setStatus({
        kind: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setSubmitting(false);
    }
  }, [canSubmit, form, loadServers]);

  const onDeleteServer = useCallback(async (serverId: string) => {
    try {
      await fetchJson<{ removed: boolean }>(`/api/servers/${encodeURIComponent(serverId)}`, {
        method: "DELETE",
      });
      setStatus({ kind: "success", message: `已删除 ${serverId}` });
      await loadServers();
    } catch (error) {
      setStatus({
        kind: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }, [loadServers]);

  const onAuthorizeServer = useCallback((serverId: string) => {
    const returnUrl = encodeURIComponent(window.location.href);
    const openerOrigin = encodeURIComponent(window.location.origin);
    const startUrl = `/api/servers/${encodeURIComponent(serverId)}/oauth/start?return_url=${returnUrl}&popup=1&opener_origin=${openerOrigin}`;
    const popup = window.open(startUrl, "gateway-oauth", "width=520,height=680,scrollbars=yes,resizable=yes");
    if (!popup) {
      setStatus({ kind: "error", message: "浏览器阻止了弹窗，请允许后重试" });
      return;
    }

    let settled = false;
    const cleanup = () => {
      window.removeEventListener("message", onMessage);
      clearInterval(timer);
    };
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data as { type?: string; serverId?: string; error?: string } | null;
      if (!data?.type) return;
      if (data.type === "gateway-oauth-done") {
        settled = true;
        cleanup();
        setStatus({ kind: "success", message: `OAuth 授权成功: ${data.serverId ?? serverId}` });
        void loadServers();
      } else if (data.type === "gateway-oauth-error") {
        settled = true;
        cleanup();
        setStatus({ kind: "error", message: `OAuth 失败: ${data.error ?? "unknown error"}` });
      }
    };
    window.addEventListener("message", onMessage);
    const timer = window.setInterval(() => {
      if (popup.closed && !settled) {
        cleanup();
        setStatus({ kind: "info", message: "OAuth 已取消" });
      }
    }, 300);
  }, [loadServers]);

  const onLogoutServer = useCallback(async (serverId: string) => {
    try {
      await fetchJson<{ removed: boolean }>(`/api/servers/${encodeURIComponent(serverId)}/oauth/logout`, {
        method: "POST",
      });
      setStatus({ kind: "success", message: `已退出 ${serverId} 的 OAuth` });
      await loadServers();
    } catch (error) {
      setStatus({
        kind: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }, [loadServers]);

  const onRevokeDelegate = useCallback(async (delegateId: string) => {
    try {
      await fetchJson(`/api/delegates/${encodeURIComponent(delegateId)}/revoke`, { method: "POST" });
      setStatus({ kind: "success", message: `已撤销 delegate ${delegateId}` });
      await loadDelegates();
    } catch (error) {
      setStatus({
        kind: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }, [loadDelegates]);

  if (authLoading) {
    return (
      <Box sx={{ minHeight: "100vh", display: "grid", placeItems: "center" }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!isLoggedIn) {
    return <LoginView />;
  }

  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "background.default" }}>
      <AppBar position="static" color="default" elevation={0} sx={{ borderBottom: 1, borderColor: "divider" }}>
        <Toolbar>
          <Typography variant="h6" fontWeight={700} sx={{ flexGrow: 1 }}>
            Gateway MCP 管理
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mr: 2 }}>
            {user?.email ?? user?.userId ?? ""}
          </Typography>
          <Button size="small" startIcon={<LogoutIcon />} onClick={() => authClient.logout()}>
            退出
          </Button>
        </Toolbar>
      </AppBar>

      <Container maxWidth="lg" sx={{ py: 4 }}>
        <Stack spacing={3}>
          {status && (
            <Alert severity={status.kind === "error" ? "error" : status.kind === "success" ? "success" : "info"}>
              {status.message}
            </Alert>
          )}

          <Paper variant="outlined" sx={{ p: 2.5 }}>
            <Typography variant="h6" sx={{ mb: 2 }}>
              新增 MCP Server
            </Typography>
            <Stack direction={{ xs: "column", md: "row" }} spacing={1.5}>
              <TextField
                label="名称"
                size="small"
                value={form.name}
                onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
              />
              <TextField
                label="URL"
                size="small"
                sx={{ minWidth: 280, flex: 1 }}
                value={form.url}
                onChange={(e) => setForm((prev) => ({ ...prev, url: e.target.value }))}
              />
              <Button
                variant="contained"
                startIcon={<AddIcon />}
                disabled={!canSubmit || submitting}
                onClick={onAddServer}
              >
                添加
              </Button>
            </Stack>
          </Paper>

          <Paper variant="outlined" sx={{ p: 2.5 }}>
            <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2 }}>
              <Typography variant="h6">已注册 Server</Typography>
              <Button size="small" startIcon={<RefreshIcon />} onClick={() => void loadServers()} disabled={loading}>
                刷新
              </Button>
            </Stack>

            {loading ? (
              <Box sx={{ py: 5, display: "grid", placeItems: "center" }}>
                <CircularProgress size={24} />
              </Box>
            ) : servers.length === 0 ? (
              <Typography color="text.secondary">暂无已注册 server</Typography>
            ) : (
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>ID</TableCell>
                      <TableCell>名称</TableCell>
                      <TableCell>URL</TableCell>
                      <TableCell align="right">操作</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {servers.map((server) => (
                      <TableRow key={server.id} hover>
                        <TableCell>{server.id}</TableCell>
                        <TableCell>{server.name}</TableCell>
                        <TableCell sx={{ maxWidth: 360, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {server.url}
                        </TableCell>
                        <TableCell align="right">
                          <Stack direction="row" spacing={1} justifyContent="flex-end">
                            {oauthStatusMap[server.id]?.requiresOAuth ? (
                              oauthStatusMap[server.id]?.loggedIn ? (
                                <Button
                                  size="small"
                                  variant="outlined"
                                  color="inherit"
                                  startIcon={<LogoutIcon />}
                                  onClick={() => void onLogoutServer(server.id)}
                                >
                                  Logout
                                </Button>
                              ) : (
                                <Button
                                  size="small"
                                  variant="outlined"
                                  startIcon={<SecurityIcon />}
                                  onClick={() => onAuthorizeServer(server.id)}
                                >
                                  Login
                                </Button>
                              )
                            ) : null}
                            <Button
                              size="small"
                              color="error"
                              startIcon={<DeleteOutlineIcon />}
                              onClick={() => void onDeleteServer(server.id)}
                            >
                              删除
                            </Button>
                          </Stack>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </Paper>

          <Paper variant="outlined" sx={{ p: 2.5 }}>
            <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2 }}>
              <Typography variant="h6">Gateway Delegates</Typography>
              <Stack direction="row" spacing={1}>
                <Button size="small" startIcon={<RefreshIcon />} onClick={() => void loadDelegates()} disabled={delegateLoading}>
                  刷新
                </Button>
                <Button size="small" variant="contained" startIcon={<AddIcon />} onClick={() => setShowCreateDelegate(true)}>
                  创建 Delegate
                </Button>
              </Stack>
            </Stack>

            <CreateDelegateDialog
              open={showCreateDelegate}
              onClose={() => setShowCreateDelegate(false)}
              onCreated={(token) => {
                setNewToken(token);
                void loadDelegates();
              }}
            />
            {newToken ? <TokenDisplay token={newToken} onDone={() => setNewToken(null)} /> : null}

            {delegateLoading ? (
              <Box sx={{ py: 5, display: "grid", placeItems: "center" }}>
                <CircularProgress size={24} />
              </Box>
            ) : delegates.length === 0 ? (
              <Typography color="text.secondary">暂无 delegates</Typography>
            ) : (
              <TableContainer sx={{ mt: 2 }}>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Name</TableCell>
                      <TableCell>Permissions</TableCell>
                      <TableCell>Created</TableCell>
                      <TableCell>Expires</TableCell>
                      <TableCell align="right">Actions</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {delegates.map((d) => (
                      <TableRow key={d.delegateId} hover>
                        <TableCell>{d.clientName}</TableCell>
                        <TableCell>
                          <Stack direction="row" spacing={0.5}>
                            {d.permissions.map((p) => (
                              <Chip key={p} label={p} size="small" variant="outlined" />
                            ))}
                          </Stack>
                        </TableCell>
                        <TableCell>{new Date(d.createdAt).toLocaleString()}</TableCell>
                        <TableCell>{d.expiresAt ? new Date(d.expiresAt).toLocaleString() : "Never"}</TableCell>
                        <TableCell align="right">
                          <Button
                            size="small"
                            color="error"
                            startIcon={<DeleteOutlineIcon />}
                            onClick={() => void onRevokeDelegate(d.delegateId)}
                          >
                            Revoke
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </Paper>
        </Stack>
      </Container>
    </Box>
  );
}
