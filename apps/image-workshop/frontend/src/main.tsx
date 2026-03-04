import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

function App() {
  const [status, setStatus] = useState<"checking" | "online" | "offline">("checking");

  useEffect(() => {
    fetch("/api/mcp", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", method: "initialize", id: 1, params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "probe", version: "0.1.0" } } }) })
      .then((r) => (r.ok ? setStatus("online") : setStatus("offline")))
      .catch(() => setStatus("offline"));
  }, []);

  const cognitoUrl = document.querySelector<HTMLMetaElement>('meta[name="cognito-hosted-ui-url"]')?.content;
  const clientId = document.querySelector<HTMLMetaElement>('meta[name="cognito-client-id"]')?.content;
  const redirectUri = `${window.location.origin}/oauth/callback`;

  const loginUrl = cognitoUrl && clientId
    ? `${cognitoUrl}/login?client_id=${clientId}&response_type=code&scope=openid+profile+email&redirect_uri=${encodeURIComponent(redirectUri)}`
    : undefined;

  return (
    <div style={{ fontFamily: "system-ui, -apple-system, sans-serif", maxWidth: 480, margin: "80px auto", textAlign: "center" }}>
      <h1 style={{ fontSize: 28, fontWeight: 600, marginBottom: 8 }}>Image Workshop</h1>
      <p style={{ color: "#666", marginBottom: 32 }}>MCP-powered image generation service</p>

      <div style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "8px 16px", borderRadius: 8, background: "#f5f5f5", marginBottom: 32 }}>
        <span style={{ width: 10, height: 10, borderRadius: "50%", background: status === "online" ? "#22c55e" : status === "offline" ? "#ef4444" : "#eab308" }} />
        <span style={{ fontSize: 14, color: "#333" }}>
          {status === "checking" ? "Checking service…" : status === "online" ? "Service online" : "Service offline"}
        </span>
      </div>

      <div>
        {loginUrl ? (
          <a href={loginUrl} style={{ display: "inline-block", padding: "12px 24px", background: "#2563eb", color: "#fff", borderRadius: 8, textDecoration: "none", fontWeight: 500, fontSize: 15 }}>
            Login with Cognito
          </a>
        ) : (
          <p style={{ fontSize: 13, color: "#999" }}>Cognito not configured — set meta tags or config endpoint.</p>
        )}
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
