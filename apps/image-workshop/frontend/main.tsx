import AddIcon from "@mui/icons-material/Add";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DoneIcon from "@mui/icons-material/Done";
import GoogleIcon from "@mui/icons-material/Google";
import LogoutIcon from "@mui/icons-material/Logout";
import MicrosoftIcon from "@mui/icons-material/Microsoft";
import {
  Alert,
  AppBar,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Container,
  CssBaseline,
  createTheme,
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
  ThemeProvider,
  Toolbar,
  Tooltip,
  Typography,
} from "@mui/material";
import { StrictMode, useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { createApiFetch, createAuthClient } from "@casfa/cell-auth-client";

const authClient = createAuthClient({ storagePrefix: "iw" });
const apiFetch = createApiFetch({
  authClient,
  baseUrl: "",
  onUnauthorized: () => authClient.logout(),
});

const theme = createTheme({
  palette: {
    mode: "light",
    primary: { main: "#2563eb" },
    error: { main: "#ef4444" },
    background: { default: "#f8fafc" },
  },
  shape: { borderRadius: 10 },
  typography: { fontFamily: "'Inter', system-ui, -apple-system, sans-serif" },
});

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

// ── OAuth Callback Complete (after backend exchanged code with Cognito) ──
let exchangeInFlight = false;

function OAuthCallbackComplete() {
  const [status, setStatus] = useState("Completing login…");

  useEffect(() => {
    if (exchangeInFlight) return;
    exchangeInFlight = true;

    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");
    if (!code) {
      setStatus("No authorization code found.");
      return;
    }

    fetch("/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "authorization_code", code }),
    })
      .then(async (r) => {
        if (!r.ok) throw new Error(`Token exchange failed: ${r.status}`);
        const data = await r.json();
        authClient.setTokens(data.id_token ?? data.access_token, data.refresh_token ?? null);
        window.history.replaceState({}, "", "/");
        window.location.reload();
      })
      .catch((e) => setStatus(`Login failed: ${e.message}`));
  }, []);

  return (
    <Box
      sx={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "100vh" }}
    >
      <Typography color="text.secondary">{status}</Typography>
    </Box>
  );
}

// ── OAuth Consent Page ──
function ConsentPage() {
  const [info, setInfo] = useState<{
    defaultClientName: string;
    userEmail?: string;
    userName?: string;
    permissions: string[];
  } | null>(null);
  const [clientName, setClientName] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const session = new URLSearchParams(window.location.search).get("session") ?? "";

  useEffect(() => {
    if (!session) {
      setError("Invalid session.");
      setLoading(false);
      return;
    }
    fetch(`/oauth/consent-info?session=${encodeURIComponent(session)}`)
      .then(async (r) => {
        if (!r.ok) throw new Error("Session expired or invalid.");
        const data = await r.json();
        setInfo(data);
        setClientName(data.defaultClientName);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [session]);

  const approve = useCallback(async () => {
    setSubmitting(true);
    try {
      const res = await fetch("/oauth/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session, clientName: clientName.trim() }),
      });
      if (!res.ok) throw new Error("Approval failed.");
      const data = await res.json();
      window.location.href = data.redirect;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSubmitting(false);
    }
  }, [session, clientName]);

  const deny = useCallback(() => {
    fetch(`/oauth/deny?session=${encodeURIComponent(session)}`, { method: "POST" });
    window.close();
  }, [session]);

  if (loading) {
    return (
      <Box
        sx={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "100vh" }}
      >
        <CircularProgress />
      </Box>
    );
  }

  if (error || !info) {
    return (
      <Box
        sx={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          bgcolor: "background.default",
        }}
      >
        <Paper elevation={1} sx={{ p: 4, maxWidth: 420, width: "100%", textAlign: "center" }}>
          <Alert severity="error">{error || "Unknown error"}</Alert>
        </Paper>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        bgcolor: "background.default",
      }}
    >
      <Paper elevation={1} sx={{ p: 4, maxWidth: 480, width: "100%" }}>
        <Typography variant="h5" fontWeight={700} gutterBottom>
          Authorize Access
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          An application is requesting delegate access to your Image Workshop account
          {info.userEmail ? ` (${info.userEmail})` : ""}.
        </Typography>

        <Stack spacing={2.5}>
          <TextField
            label="Client Name"
            value={clientName}
            onChange={(e) => setClientName(e.target.value)}
            size="small"
            fullWidth
            helperText="Give this delegate a recognizable name for easier management"
          />

          <Box>
            <Typography variant="body2" fontWeight={500} sx={{ mb: 0.5 }}>
              Permissions Requested
            </Typography>
            <Stack direction="row" spacing={0.5}>
              {info.permissions.map((p) => (
                <Chip key={p} label={p} size="small" variant="outlined" />
              ))}
            </Stack>
          </Box>

          <Stack direction="row" spacing={1.5} sx={{ pt: 1 }}>
            <Button
              variant="contained"
              onClick={approve}
              disabled={submitting || !clientName.trim()}
              fullWidth
            >
              {submitting ? "Authorizing…" : "Approve"}
            </Button>
            <Button variant="outlined" onClick={deny} disabled={submitting} fullWidth>
              Deny
            </Button>
          </Stack>
        </Stack>
      </Paper>
    </Box>
  );
}

// ── Login Page ──
function LoginPage() {
  return (
    <Box
      sx={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        bgcolor: "background.default",
      }}
    >
      <Paper elevation={1} sx={{ p: 5, maxWidth: 420, width: "100%", textAlign: "center" }}>
        <Typography variant="h5" fontWeight={700} gutterBottom>
          Image Workshop
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 4 }}>
          Sign in to manage delegates and access MCP tools
        </Typography>
        <Stack spacing={1.5}>
          <Button
            variant="outlined"
            size="large"
            startIcon={<GoogleIcon />}
            href="/oauth/authorize?identity_provider=Google"
            fullWidth
          >
            Sign in with Google
          </Button>
          <Button
            variant="outlined"
            size="large"
            startIcon={<MicrosoftIcon />}
            href="/oauth/authorize?identity_provider=Microsoft"
            fullWidth
          >
            Sign in with Microsoft
          </Button>
        </Stack>
      </Paper>
    </Box>
  );
}

// ── Create Delegate Dialog ──
function CreateDelegateDialog({
  open,
  onCreated,
  onClose,
}: {
  open: boolean;
  onCreated: (d: NewDelegate) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [useMcp, setUseMcp] = useState(true);
  const [manageDelegates, setManageDelegates] = useState(false);
  const [ttlHours, setTtlHours] = useState(24);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  const submit = useCallback(async () => {
    if (!name.trim()) return;
    setCreating(true);
    setError("");
    const permissions: string[] = [];
    if (useMcp) permissions.push("use_mcp");
    if (manageDelegates) permissions.push("manage_delegates");

    try {
      const res = await apiFetch("/api/delegates", {
        method: "POST",
        body: JSON.stringify({
          clientName: name.trim(),
          permissions,
          ttl: ttlHours * 3600 * 1000,
        }),
      });
      if (!res.ok) throw new Error(`Failed: ${res.status}`);
      onCreated(await res.json());
      setName("");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setCreating(false);
  }, [name, useMcp, manageDelegates, ttlHours, onCreated]);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Create Delegate</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            label="Client Name"
            placeholder="e.g. Claude Desktop"
            value={name}
            onChange={(e) => setName(e.target.value)}
            size="small"
            fullWidth
            autoFocus
          />
          <Box>
            <Typography variant="body2" fontWeight={500} sx={{ mb: 0.5 }}>
              Permissions
            </Typography>
            <FormControlLabel
              control={
                <Checkbox
                  checked={useMcp}
                  onChange={(e) => setUseMcp(e.target.checked)}
                  size="small"
                />
              }
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
            value={ttlHours}
            onChange={(e) => setTtlHours(Number(e.target.value))}
            size="small"
            slotProps={{ htmlInput: { min: 1, max: 8760 } }}
            sx={{ width: 150 }}
          />
          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={submit} disabled={creating || !name.trim()}>
          {creating ? "Creating…" : "Create"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ── Token Display ──
function TokenDisplay({ token, onDone }: { token: NewDelegate; onDone: () => void }) {
  const [copied, setCopied] = useState<string | null>(null);

  const copy = useCallback((text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopied(field);
    setTimeout(() => setCopied(null), 2000);
  }, []);

  return (
    <Alert severity="success" sx={{ mb: 2 }} action={<Button onClick={onDone}>Done</Button>}>
      <Typography variant="subtitle2" sx={{ mb: 1 }}>
        Delegate Created — {token.clientName}
      </Typography>
      {(["accessToken", "refreshToken"] as const).map((field) => (
        <Box key={field} sx={{ mb: 1 }}>
          <Typography variant="caption" fontWeight={500}>
            {field === "accessToken" ? "Access Token" : "Refresh Token"}
          </Typography>
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, mt: 0.5 }}>
            <Box
              component="code"
              sx={{
                flex: 1,
                p: 0.75,
                bgcolor: "grey.50",
                borderRadius: 1,
                fontSize: 11,
                wordBreak: "break-all",
                border: "1px solid",
                borderColor: "grey.300",
              }}
            >
              {token[field]}
            </Box>
            <Tooltip title={copied === field ? "Copied!" : "Copy"}>
              <IconButton size="small" onClick={() => copy(token[field], field)}>
                {copied === field ? (
                  <DoneIcon fontSize="small" />
                ) : (
                  <ContentCopyIcon fontSize="small" />
                )}
              </IconButton>
            </Tooltip>
          </Box>
        </Box>
      ))}
    </Alert>
  );
}

// ── Delegates Page ──
function DelegatesPage() {
  const [delegates, setDelegates] = useState<Delegate[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [newToken, setNewToken] = useState<NewDelegate | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);

  const fetchDelegates = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch("/api/delegates", null);
      if (res.ok) setDelegates(await res.json());
    } catch {
      /* ignore */
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchDelegates();
  }, [fetchDelegates]);

  const revoke = useCallback(
    async (id: string) => {
      setRevoking(id);
      try {
        await apiFetch(`/api/delegates/${id}/revoke`, { method: "POST" });
        await fetchDelegates();
      } catch {
        /* ignore */
      }
      setRevoking(null);
    },
    [fetchDelegates]
  );

  return (
    <>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 2 }}>
        <Typography variant="h6" fontWeight={600}>
          Delegates
        </Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setShowCreate(true)}>
          Create Delegate
        </Button>
      </Box>

      {newToken && (
        <TokenDisplay
          token={newToken}
          onDone={() => {
            setNewToken(null);
            fetchDelegates();
          }}
        />
      )}

      <CreateDelegateDialog
        open={showCreate}
        onCreated={(d) => {
          setNewToken(d);
          setShowCreate(false);
        }}
        onClose={() => setShowCreate(false)}
      />

      {loading ? (
        <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
          <CircularProgress />
        </Box>
      ) : delegates.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 4, textAlign: "center" }}>
          <Typography color="text.secondary">
            No delegates yet. Create one to get started.
          </Typography>
        </Paper>
      ) : (
        <TableContainer component={Paper} variant="outlined">
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
                  <TableCell sx={{ color: "text.secondary" }}>
                    {new Date(d.createdAt).toLocaleString()}
                  </TableCell>
                  <TableCell sx={{ color: "text.secondary" }}>
                    {d.expiresAt ? new Date(d.expiresAt).toLocaleString() : "Never"}
                  </TableCell>
                  <TableCell align="right">
                    <Button
                      size="small"
                      color="error"
                      onClick={() => revoke(d.delegateId)}
                      disabled={revoking === d.delegateId}
                    >
                      {revoking === d.delegateId ? "Revoking…" : "Revoke"}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </>
  );
}

// ── App ──
function App() {
  const auth = useSyncExternalStore(
    (onStoreChange) => authClient.subscribe(() => onStoreChange()),
    () => authClient.getAuth(),
  );

  if (window.location.pathname === "/oauth/consent") {
    return <ConsentPage />;
  }

  if (window.location.pathname === "/oauth/callback-complete") {
    return <OAuthCallbackComplete />;
  }

  if (!auth) {
    return <LoginPage />;
  }

  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "background.default" }}>
      <AppBar
        position="static"
        color="default"
        elevation={0}
        sx={{ borderBottom: 1, borderColor: "divider" }}
      >
        <Toolbar>
          <Typography variant="h6" fontWeight={700} sx={{ flexGrow: 1 }}>
            Image Workshop
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mr: 1 }}>
            {auth.email ?? auth.userId}
          </Typography>
          <Button size="small" startIcon={<LogoutIcon />} onClick={() => authClient.logout()}>
            Logout
          </Button>
        </Toolbar>
      </AppBar>
      <Container maxWidth="md" sx={{ py: 4 }}>
        <DelegatesPage />
      </Container>
    </Box>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <App />
    </ThemeProvider>
  </StrictMode>
);
