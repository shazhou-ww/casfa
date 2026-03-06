import type React from "react";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";

export interface DelegateOAuthConsentPageProps {
  authorizeUrl: string;
  loginUrl: string;
  /** Base URL for client-info lookup (e.g. "" for same-origin). Used when URL has client_id but no client_name. */
  clientInfoUrl?: string;
  /** True only after auth check has completed (wait for this before redirecting to login). */
  loading: boolean;
  isLoggedIn: boolean;
  fetch?: typeof window.fetch;
  scopeDescriptions?: Record<string, string>;
}

/** Parse scope from URL (space or + separated) into array for display. */
function parseScope(scope: string | null): string[] {
  if (!scope || !scope.trim()) return [];
  return scope.split(/[\s+]+/).filter(Boolean);
}

/** Normalize scope for request body: keep original string or space-join if we have array. */
function scopeForBody(scopeParam: string | null, scopes: string[]): string {
  if (scopeParam != null && scopeParam.trim() !== "") return scopeParam.trim();
  return scopes.join(" ");
}

export function DelegateOAuthConsentPage({
  authorizeUrl,
  loginUrl,
  clientInfoUrl = "",
  loading,
  isLoggedIn,
  fetch: fetchFn = window.fetch,
  scopeDescriptions = {},
}: DelegateOAuthConsentPageProps): React.ReactElement | null {
  const [searchParams] = useSearchParams();
  const clientNameParam = searchParams.get("client_name") ?? "";
  const clientIdParam = searchParams.get("client_id") ?? "";
  const redirectUri = searchParams.get("redirect_uri") ?? "";
  const state = searchParams.get("state") ?? "";
  const codeChallenge = searchParams.get("code_challenge") ?? "";
  const codeChallengeMethod = searchParams.get("code_challenge_method") ?? "S256";
  const scopeParam = searchParams.get("scope");

  const scopes = useMemo(() => parseScope(scopeParam), [scopeParam]);

  const [clientName, setClientName] = useState(clientNameParam || "此应用");
  const [loadingPost, setLoadingPost] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // When URL has client_name, use it
  useEffect(() => {
    if (clientNameParam) setClientName(clientNameParam);
  }, [clientNameParam]);

  // When URL has client_id but no client_name, fetch name from registration (GET /oauth/client-info)
  useEffect(() => {
    if (clientNameParam || !clientIdParam.trim()) return;
    const base = clientInfoUrl.replace(/\/$/, "");
    const url = `${base}/oauth/client-info?client_id=${encodeURIComponent(clientIdParam)}`;
    fetchFn(url, { credentials: "include" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { client_name?: string } | null) => {
        if (data?.client_name) setClientName(data.client_name);
      })
      .catch(() => {});
  }, [clientIdParam, clientNameParam, clientInfoUrl, fetchFn]);

  // Not logged in: redirect to login only after auth check has completed (avoid redirect loop)
  useEffect(() => {
    if (!loading && !isLoggedIn) {
      const returnUrl = encodeURIComponent(window.location.href);
      window.location.href = `${loginUrl}?return_url=${returnUrl}`;
    }
  }, [loading, isLoggedIn, loginUrl]);

  if (loading || !isLoggedIn) return null;

  const handleAllow = async () => {
    setError(null);
    setLoadingPost(true);
    try {
      const body = {
        client_name: clientName,
        redirect_uri: redirectUri,
        state,
        code_challenge: codeChallenge,
        code_challenge_method: codeChallengeMethod || "S256",
        scope: scopeForBody(scopeParam, scopes),
      };
      const res = await fetchFn(authorizeUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { redirect_url?: string };
      if (!res.ok) {
        const errData = data as { message?: string };
        setError(errData?.message ?? `请求失败: ${res.status}`);
        setLoadingPost(false);
        return;
      }
      const redirectUrl = data.redirect_url;
      if (redirectUrl) {
        window.location.href = redirectUrl;
        return;
      }
      setError("服务器未返回重定向地址");
    } catch (e) {
      setError(e instanceof Error ? e.message : "网络错误");
    } finally {
      setLoadingPost(false);
    }
  };

  const handleDeny = () => {
    const sep = redirectUri.includes("?") ? "&" : "?";
    const denyRedirect = `${redirectUri}${sep}error=access_denied&state=${encodeURIComponent(state)}`;
    if (clientIdParam.trim()) {
      const base = clientInfoUrl.replace(/\/$/, "");
      const url = `${base}/oauth/client-info?client_id=${encodeURIComponent(clientIdParam)}`;
      fetchFn(url, { method: "DELETE", credentials: "include" }).catch(() => {});
    }
    window.location.href = denyRedirect;
  };

  return (
    <Box sx={{ p: 2, maxWidth: 480, mx: "auto" }}>
      <Card>
        <CardContent>
          <Typography variant="h6" component="h1" gutterBottom>
            授权应用
          </Typography>
          <TextField
            label="应用名称"
            value={clientName}
            onChange={(e) => setClientName(e.target.value)}
            fullWidth
            margin="normal"
            disabled={loadingPost}
          />
          {scopes.length > 0 && (
            <>
              <Typography variant="subtitle2" sx={{ mt: 2, mb: 1 }}>
                将授予的权限
              </Typography>
              <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
                {scopes.map((scope) => (
                  <Typography component="li" key={scope} variant="body2">
                    {scopeDescriptions[scope] ?? scope}
                  </Typography>
                ))}
              </Box>
            </>
          )}
          {error != null && (
            <Typography color="error" variant="body2" sx={{ mt: 1 }}>
              {error}
            </Typography>
          )}
          <Box sx={{ mt: 2, display: "flex", gap: 1 }}>
            <Button variant="contained" onClick={handleAllow} disabled={loadingPost}>
              {loadingPost ? "处理中…" : "允许"}
            </Button>
            <Button variant="outlined" onClick={handleDeny} disabled={loadingPost}>
              拒绝
            </Button>
          </Box>
        </CardContent>
      </Card>
    </Box>
  );
}
