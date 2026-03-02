import { Box, Button, Card, CardContent, TextField, Typography } from "@mui/material";
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useAuthStore } from "../stores/auth-store";
import { apiFetch } from "../lib/auth";

export function OAuthAuthorizePage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const isLoggedIn = useAuthStore((s) => s.isLoggedIn);
  const initialized = useAuthStore((s) => s.initialized);
  const initialize = useAuthStore((s) => s.initialize);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [redirectUrl, setRedirectUrl] = useState<string | null>(null);

  const client_id = searchParams.get("client_id") ?? "";
  const [clientName, setClientName] = useState(client_id);
  const redirect_uri = searchParams.get("redirect_uri") ?? "";
  const state = searchParams.get("state") ?? "";
  const code_challenge = searchParams.get("code_challenge") ?? "";
  const code_challenge_method = searchParams.get("code_challenge_method") ?? "S256";

  useEffect(() => {
    initialize();
  }, [initialize]);

  // Not logged in: redirect to login with returnUrl so we come back here after
  useEffect(() => {
    if (!initialized) return;
    if (!isLoggedIn) {
      const returnUrl = `/oauth/authorize?${searchParams.toString()}`;
      navigate(`/login?returnUrl=${encodeURIComponent(returnUrl)}`, { replace: true });
    }
  }, [initialized, isLoggedIn, navigate, searchParams]);

  const handleAllow = useCallback(async () => {
    if (!client_id || !redirect_uri || !state || !code_challenge) {
      setError("Missing client_id, redirect_uri, state, or code_challenge");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const res = await apiFetch("/api/oauth/mcp/authorize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id,
          client_name: clientName.trim() || client_id,
          redirect_uri,
          state,
          code_challenge,
          code_challenge_method: code_challenge_method || "S256",
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError((data as { message?: string }).message ?? res.statusText);
        setSubmitting(false);
        return;
      }
      const data = (await res.json()) as { redirect_url?: string };
      if (data.redirect_url) {
        setRedirectUrl(data.redirect_url);
        window.location.href = data.redirect_url;
        return;
      }
      setError("Server did not return redirect_url");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    }
    setSubmitting(false);
  }, [client_id, clientName, redirect_uri, state, code_challenge, code_challenge_method]);

  const handleDeny = useCallback(() => {
    if (redirect_uri) {
      const sep = redirect_uri.includes("?") ? "&" : "?";
      const errorUri = `${redirect_uri}${sep}error=access_denied&state=${encodeURIComponent(state)}`;
      window.location.href = errorUri;
    } else {
      navigate("/", { replace: true });
    }
  }, [redirect_uri, state, navigate]);

  if (!initialized || !isLoggedIn) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" minHeight="100vh">
        <Typography color="text.secondary">Redirecting to login…</Typography>
      </Box>
    );
  }

  return (
    <Box
      display="flex"
      justifyContent="center"
      alignItems="center"
      minHeight="100vh"
      bgcolor="grey.50"
    >
      <Card sx={{ maxWidth: 420, width: "100%", mx: 2 }}>
        <CardContent sx={{ p: 4 }}>
          <Typography variant="h6" component="h1" gutterBottom>
            Authorize Cursor MCP
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Allow <strong>{client_id || "this client"}</strong> to access your Casfa realm (files and branches)?
          </Typography>
          <TextField
            fullWidth
            label="Client name"
            helperText={client_id ? `Caller suggested: ${client_id}. You can change this.` : undefined}
            value={clientName}
            onChange={(e) => setClientName(e.target.value)}
            disabled={submitting || !!redirectUrl}
            sx={{ mb: 2 }}
          />
          {error && (
            <Typography color="error" variant="body2" sx={{ mb: 2 }}>
              {error}
            </Typography>
          )}
          {redirectUrl && (
            <Typography variant="body2" sx={{ mb: 2 }}>
              Redirecting to Cursor… If nothing happens,{" "}
              <Typography component="a" href={redirectUrl} sx={{ color: "primary.main", cursor: "pointer", textDecoration: "underline" }}>
                click here to open Cursor
              </Typography>
            </Typography>
          )}
          <Box display="flex" gap={1} justifyContent="flex-end">
            <Button variant="outlined" onClick={handleDeny} disabled={submitting || !!redirectUrl}>
              Deny
            </Button>
            <Button variant="contained" onClick={handleAllow} disabled={submitting || !!redirectUrl}>
              {submitting ? "…" : "Allow"}
            </Button>
          </Box>
        </CardContent>
      </Card>
    </Box>
  );
}
