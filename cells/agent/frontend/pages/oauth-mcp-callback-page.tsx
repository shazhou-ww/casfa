import { Box, Typography } from "@mui/material";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { exchangeCode } from "../lib/mcp-oauth-flow.ts";

/** MCP OAuth callback: exchange code for token, save to IndexedDB. If opened in popup, postMessage to opener and close; else redirect to settings. */
export function OAuthMcpCallbackPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const notifiedRef = useRef(false);

  useEffect(() => {
    const code = searchParams.get("code");
    const state = searchParams.get("state");
    console.log("[MCP OAuth] callback: code=%s state=%s opener=%s", !!code, !!state, !!window.opener);
    if (!code || !state) {
      setError("Missing code or state");
      return;
    }
    console.log("[MCP OAuth] callback: exchanging code for token...");
    exchangeCode(state, code)
      .then((result) => {
        if (notifiedRef.current) return;
        notifiedRef.current = true;
        console.log("[MCP OAuth] callback: token saved serverId=%s, opener=%s", result.serverId, !!window.opener);
        if (window.opener) {
          window.opener.postMessage({ type: "mcp-oauth-done", serverId: result.serverId }, window.location.origin);
          window.close();
        } else {
          navigate("/settings", { replace: true });
        }
      })
      .catch((e) => {
        if (notifiedRef.current) return;
        notifiedRef.current = true;
        const msg = e instanceof Error ? e.message : String(e);
        console.error("[MCP OAuth] callback: exchange failed", e);
        if (window.opener) {
          window.opener.postMessage({ type: "mcp-oauth-error", error: msg }, window.location.origin);
          window.close();
        } else {
          setError(msg);
        }
      });
  }, [searchParams, navigate]);

  if (error) {
    return (
      <Box display="flex" flexDirection="column" alignItems="center" justifyContent="center" minHeight="100vh" gap={2}>
        <Typography color="error">OAuth failed: {error}</Typography>
        <Typography variant="body2" color="text.secondary" component="a" href="/settings">
          Back to Settings
        </Typography>
      </Box>
    );
  }

  return (
    <Box display="flex" justifyContent="center" alignItems="center" minHeight="100vh">
      <Typography color="text.secondary">Completing login…</Typography>
    </Box>
  );
}
