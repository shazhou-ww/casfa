import { StrictMode, useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { apiFetch } from "./lib/api";
import { getAuth, logout, setTokens, subscribe } from "./lib/auth";

// ── Types ──
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

// ── Styles ──
const colors = {
  bg: "#fafafa",
  card: "#fff",
  border: "#e5e7eb",
  primary: "#2563eb",
  primaryHover: "#1d4ed8",
  danger: "#ef4444",
  dangerHover: "#dc2626",
  text: "#111827",
  textSecondary: "#6b7280",
  green: "#22c55e",
  greenBg: "#f0fdf4",
};

const btnBase: React.CSSProperties = {
  padding: "10px 20px",
  borderRadius: 8,
  border: "none",
  fontWeight: 500,
  fontSize: 14,
  cursor: "pointer",
  transition: "background 0.15s",
};

// ── OAuth Callback Handler ──
function OAuthCallback() {
  const [status, setStatus] = useState("Exchanging code…");

  useEffect(() => {
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
        const token = data.id_token ?? data.access_token;
        setTokens(token, data.refresh_token);
        window.history.replaceState({}, "", "/");
        window.location.reload();
      })
      .catch((e) => setStatus(`Login failed: ${e.message}`));
  }, []);

  return (
    <div style={{ textAlign: "center", marginTop: 120, fontFamily: "system-ui" }}>
      <p style={{ color: colors.textSecondary }}>{status}</p>
    </div>
  );
}

// ── Login Page ──
function LoginPage() {
  return (
    <div
      style={{
        fontFamily: "system-ui, -apple-system, sans-serif",
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: colors.bg,
      }}
    >
      <div
        style={{
          background: colors.card,
          borderRadius: 16,
          padding: "48px 40px",
          boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
          textAlign: "center",
          maxWidth: 400,
          width: "100%",
        }}
      >
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: "0 0 8px", color: colors.text }}>
          Image Workshop
        </h1>
        <p style={{ color: colors.textSecondary, margin: "0 0 32px", fontSize: 14 }}>
          Sign in to manage delegates and access MCP tools
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <a
            href="/oauth/authorize?identity_provider=Google"
            style={{
              ...btnBase,
              display: "block",
              textDecoration: "none",
              background: colors.card,
              color: colors.text,
              border: `1px solid ${colors.border}`,
              textAlign: "center" as const,
            }}
          >
            Sign in with Google
          </a>

          <a
            href="/oauth/authorize?identity_provider=Microsoft"
            style={{
              ...btnBase,
              display: "block",
              textDecoration: "none",
              background: colors.card,
              color: colors.text,
              border: `1px solid ${colors.border}`,
              textAlign: "center" as const,
            }}
          >
            Sign in with Microsoft
          </a>
        </div>
      </div>
    </div>
  );
}

// ── Create Delegate Form ──
function CreateDelegateForm({
  onCreated,
  onCancel,
}: {
  onCreated: (d: NewDelegate) => void;
  onCancel: () => void;
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
      const data = await res.json();
      onCreated(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setCreating(false);
  }, [name, useMcp, manageDelegates, ttlHours, onCreated]);

  return (
    <div
      style={{
        background: colors.card,
        borderRadius: 12,
        border: `1px solid ${colors.border}`,
        padding: 24,
        marginBottom: 16,
      }}
    >
      <h3 style={{ margin: "0 0 16px", fontSize: 16, fontWeight: 600 }}>Create Delegate</h3>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <input
          placeholder="Client name (e.g. Claude Desktop)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={{
            padding: "8px 12px",
            borderRadius: 6,
            border: `1px solid ${colors.border}`,
            fontSize: 14,
          }}
        />
        <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
          <input type="checkbox" checked={useMcp} onChange={(e) => setUseMcp(e.target.checked)} />
          use_mcp
        </label>
        <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
          <input
            type="checkbox"
            checked={manageDelegates}
            onChange={(e) => setManageDelegates(e.target.checked)}
          />
          manage_delegates
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
          TTL (hours):
          <input
            type="number"
            min={1}
            max={8760}
            value={ttlHours}
            onChange={(e) => setTtlHours(Number(e.target.value))}
            style={{
              width: 80,
              padding: "6px 8px",
              borderRadius: 6,
              border: `1px solid ${colors.border}`,
              fontSize: 14,
            }}
          />
        </label>
        {error && <p style={{ color: colors.danger, fontSize: 13, margin: 0 }}>{error}</p>}
        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            onClick={submit}
            disabled={creating || !name.trim()}
            style={{ ...btnBase, background: colors.primary, color: "#fff", flex: 1 }}
          >
            {creating ? "Creating…" : "Create"}
          </button>
          <button
            type="button"
            onClick={onCancel}
            style={{ ...btnBase, background: "#f3f4f6", color: colors.text }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Token Display (shown after creation) ──
function TokenDisplay({
  token,
  label,
  onDone,
}: {
  token: NewDelegate;
  label?: string;
  onDone: () => void;
}) {
  const [copied, setCopied] = useState<string | null>(null);

  const copy = useCallback((text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopied(field);
    setTimeout(() => setCopied(null), 2000);
  }, []);

  return (
    <div
      style={{
        background: colors.greenBg,
        borderRadius: 12,
        border: `1px solid ${colors.green}`,
        padding: 20,
        marginBottom: 16,
      }}
    >
      <h4 style={{ margin: "0 0 12px", fontSize: 14, fontWeight: 600, color: "#166534" }}>
        {label ?? "Delegate Created"} — {token.clientName}
      </h4>
      <div style={{ fontSize: 13, display: "flex", flexDirection: "column", gap: 8 }}>
        <div>
          <span style={{ fontWeight: 500 }}>Access Token:</span>
          <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
            <code
              style={{
                flex: 1,
                padding: "6px 8px",
                background: "#fff",
                borderRadius: 4,
                fontSize: 11,
                wordBreak: "break-all",
                border: `1px solid ${colors.border}`,
              }}
            >
              {token.accessToken}
            </code>
            <button
              type="button"
              onClick={() => copy(token.accessToken, "access")}
              style={{ ...btnBase, padding: "4px 10px", fontSize: 12, background: "#e5e7eb" }}
            >
              {copied === "access" ? "Copied!" : "Copy"}
            </button>
          </div>
        </div>
        <div>
          <span style={{ fontWeight: 500 }}>Refresh Token:</span>
          <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
            <code
              style={{
                flex: 1,
                padding: "6px 8px",
                background: "#fff",
                borderRadius: 4,
                fontSize: 11,
                wordBreak: "break-all",
                border: `1px solid ${colors.border}`,
              }}
            >
              {token.refreshToken}
            </code>
            <button
              type="button"
              onClick={() => copy(token.refreshToken, "refresh")}
              style={{ ...btnBase, padding: "4px 10px", fontSize: 12, background: "#e5e7eb" }}
            >
              {copied === "refresh" ? "Copied!" : "Copy"}
            </button>
          </div>
        </div>
      </div>
      <button
        type="button"
        onClick={onDone}
        style={{ ...btnBase, marginTop: 12, background: "#dcfce7", color: "#166534", fontSize: 13 }}
      >
        Done
      </button>
    </div>
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
      const res = await apiFetch("/api/delegates");
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

  const formatDate = (ts: number) => new Date(ts).toLocaleString();

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 16,
        }}
      >
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Delegates</h2>
        {!showCreate && (
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            style={{ ...btnBase, background: colors.primary, color: "#fff" }}
          >
            Create Delegate
          </button>
        )}
      </div>

      {newToken && (
        <TokenDisplay
          token={newToken}
          onDone={() => {
            setNewToken(null);
            fetchDelegates();
          }}
        />
      )}

      {showCreate && (
        <CreateDelegateForm
          onCreated={(d) => {
            setNewToken(d);
            setShowCreate(false);
          }}
          onCancel={() => setShowCreate(false)}
        />
      )}

      {loading ? (
        <p style={{ color: colors.textSecondary, fontSize: 14 }}>Loading…</p>
      ) : delegates.length === 0 ? (
        <p style={{ color: colors.textSecondary, fontSize: 14 }}>
          No delegates yet. Create one to get started.
        </p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: 13,
            }}
          >
            <thead>
              <tr
                style={{
                  borderBottom: `2px solid ${colors.border}`,
                  textAlign: "left",
                }}
              >
                <th style={{ padding: "8px 12px", fontWeight: 600 }}>Name</th>
                <th style={{ padding: "8px 12px", fontWeight: 600 }}>Permissions</th>
                <th style={{ padding: "8px 12px", fontWeight: 600 }}>Created</th>
                <th style={{ padding: "8px 12px", fontWeight: 600 }}>Expires</th>
                <th style={{ padding: "8px 12px", fontWeight: 600 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {delegates.map((d) => (
                <tr key={d.delegateId} style={{ borderBottom: `1px solid ${colors.border}` }}>
                  <td style={{ padding: "10px 12px" }}>{d.clientName}</td>
                  <td style={{ padding: "10px 12px" }}>
                    {d.permissions.map((p) => (
                      <span
                        key={p}
                        style={{
                          display: "inline-block",
                          padding: "2px 8px",
                          borderRadius: 4,
                          background: "#f3f4f6",
                          fontSize: 11,
                          marginRight: 4,
                        }}
                      >
                        {p}
                      </span>
                    ))}
                  </td>
                  <td style={{ padding: "10px 12px", color: colors.textSecondary }}>
                    {formatDate(d.createdAt)}
                  </td>
                  <td style={{ padding: "10px 12px", color: colors.textSecondary }}>
                    {d.expiresAt ? formatDate(d.expiresAt) : "Never"}
                  </td>
                  <td style={{ padding: "10px 12px" }}>
                    <button
                      type="button"
                      onClick={() => revoke(d.delegateId)}
                      disabled={revoking === d.delegateId}
                      style={{
                        ...btnBase,
                        padding: "4px 12px",
                        fontSize: 12,
                        background: "#fef2f2",
                        color: colors.danger,
                        border: `1px solid #fecaca`,
                      }}
                    >
                      {revoking === d.delegateId ? "Revoking…" : "Revoke"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Main App ──
function App() {
  const auth = useSyncExternalStore(subscribe, getAuth);

  if (window.location.pathname === "/oauth/callback") {
    return <OAuthCallback />;
  }

  if (!auth) {
    return <LoginPage />;
  }

  return (
    <div
      style={{
        fontFamily: "system-ui, -apple-system, sans-serif",
        minHeight: "100vh",
        background: colors.bg,
      }}
    >
      <header
        style={{
          background: colors.card,
          borderBottom: `1px solid ${colors.border}`,
          padding: "12px 24px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: colors.text }}>
          Image Workshop
        </h1>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 13, color: colors.textSecondary }}>
            {auth.email ?? auth.userId}
          </span>
          <button
            type="button"
            onClick={logout}
            style={{
              ...btnBase,
              padding: "6px 14px",
              fontSize: 13,
              background: "#f3f4f6",
              color: colors.text,
            }}
          >
            Logout
          </button>
        </div>
      </header>
      <main style={{ maxWidth: 900, margin: "32px auto", padding: "0 24px" }}>
        <DelegatesPage />
      </main>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
