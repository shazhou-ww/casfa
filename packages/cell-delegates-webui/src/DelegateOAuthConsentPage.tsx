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
  isLoggedIn,
  fetch: fetchFn = window.fetch,
  scopeDescriptions = {},
}: DelegateOAuthConsentPageProps): React.ReactElement | null {
  const [searchParams] = useSearchParams();
  const clientNameParam = searchParams.get("client_name") ?? "";
  const redirectUri = searchParams.get("redirect_uri") ?? "";
  const state = searchParams.get("state") ?? "";
  const codeChallenge = searchParams.get("code_challenge") ?? "";
  const codeChallengeMethod = searchParams.get("code_challenge_method") ?? "S256";
  const scopeParam = searchParams.get("scope");

  const scopes = useMemo(() => parseScope(scopeParam), [scopeParam]);

  const [clientName, setClientName] = useState(clientNameParam || "此应用");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sync display name when URL client_name changes (e.g. first render)
  useEffect(() => {
    if (clientNameParam) setClientName(clientNameParam);
  }, [clientNameParam]);

  // Not logged in: redirect to login with return_url
  useEffect(() => {
    if (!isLoggedIn) {
      const returnUrl = encodeURIComponent(window.location.href);
      window.location.href = `${loginUrl}?return_url=${returnUrl}`;
    }
  }, [isLoggedIn, loginUrl]);

  if (!isLoggedIn) return null;

  const handleAllow = async () => {
    setError(null);
    setLoading(true);
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
        setLoading(false);
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
      setLoading(false);
    }
  };

  const handleDeny = () => {
    const sep = redirectUri.includes("?") ? "&" : "?";
    window.location.href = `${redirectUri}${sep}error=access_denied&state=${encodeURIComponent(state)}`;
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
            disabled={loading}
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
            <Button variant="contained" onClick={handleAllow} disabled={loading}>
              {loading ? "处理中…" : "允许"}
            </Button>
            <Button variant="outlined" onClick={handleDeny} disabled={loading}>
              拒绝
            </Button>
          </Box>
        </CardContent>
      </Card>
    </Box>
  );
}
