/**
 * MCP OAuth flow: discovery (from 401 or from config), PKCE, and code exchange.
 * Pending state (code_verifier) stored in sessionStorage until callback.
 */

import { setMCPToken } from "./mcp-oauth-tokens.ts";
import { buildOAuthAuthorizationServerMetadataUrl } from "./oauth-discovery-url";
import type {
  MCPServerConfig,
  OAuthAuthorizationServerMetadata,
  OAuthProtectedResourceMetadata,
} from "./mcp-types.ts";

const PENDING_KEY = "mcp_oauth_pending";

/** Prevent duplicate token exchange when React runs effect twice (Strict Mode). */
const exchangeInFlight = new Set<string>();

function getMountBasePath(): string {
  if (typeof window === "undefined") return "";
  const seg = window.location.pathname.split("/").filter(Boolean)[0];
  return seg ? `/${seg}` : "";
}

function withMountPath(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  const base = getMountBasePath();
  if (!base) return normalized;
  if (normalized === base || normalized.startsWith(`${base}/`)) return normalized;
  return `${base}${normalized}`;
}

export type OAuthDiscoveryResult = {
  resourceMetadata: OAuthProtectedResourceMetadata;
  asMetadata: OAuthAuthorizationServerMetadata;
  resourceUrl: string;
  asBaseUrl: string;
};

/** Parse WWW-Authenticate header for resource_metadata (RFC 9728). */
export function parseWwwAuthenticateResourceMetadata(wwwAuth: string | null): string | null {
  if (!wwwAuth) return null;
  const match = wwwAuth.match(/resource_metadata="([^"]+)"/);
  return match ? match[1].replace(/\\"/g, '"') : null;
}

/** Fetch Protected Resource Metadata from URL. */
export async function fetchResourceMetadata(url: string): Promise<OAuthProtectedResourceMetadata> {
  const res = await fetch(url, { method: "GET", credentials: "omit" });
  if (!res.ok) throw new Error(`Resource metadata fetch failed: ${res.status} ${url}`);
  return (await res.json()) as OAuthProtectedResourceMetadata;
}

/** Try OIDC and RFC8414 well-known paths for AS metadata. */
export async function fetchAuthorizationServerMetadata(issuerUrl: string): Promise<OAuthAuthorizationServerMetadata> {
  const base = issuerUrl.replace(/\/$/, "");
  const rfc8414Url = buildOAuthAuthorizationServerMetadataUrl(issuerUrl);
  const candidates = [
    rfc8414Url,
    `${base}/.well-known/openid-configuration`,
    `${base}/.well-known/oauth-authorization-server`, // Backward compatibility for old issuer-local layout.
  ];
  for (const url of candidates) {
    try {
      const res = await fetch(url, { method: "GET", credentials: "omit" });
      if (res.ok) return (await res.json()) as OAuthAuthorizationServerMetadata;
    } catch {
      /* try next */
    }
  }
  throw new Error(`Could not fetch AS metadata from ${issuerUrl}`);
}

/** Discover from 401 response: WWW-Authenticate -> resource_metadata -> AS metadata. */
export async function discoverFrom401(response: Response, serverUrl: string): Promise<OAuthDiscoveryResult> {
  const wwwAuth = response.headers.get("WWW-Authenticate");
  let resourceMetadata: OAuthProtectedResourceMetadata;
  if (wwwAuth) {
    const resourceMetadataUrl = parseWwwAuthenticateResourceMetadata(wwwAuth);
    if (resourceMetadataUrl) {
      resourceMetadata = await fetchResourceMetadata(resourceMetadataUrl);
    } else {
      resourceMetadata = await fetchResourceMetadataFromWellKnown(serverUrl);
    }
  } else {
    resourceMetadata = await fetchResourceMetadataFromWellKnown(serverUrl);
  }
  const authServers = resourceMetadata.authorization_servers;
  if (!authServers?.length) throw new Error("No authorization_servers in resource metadata");
  const asBaseUrl = authServers[0];
  const asMetadata = await fetchAuthorizationServerMetadata(asBaseUrl);
  return {
    resourceMetadata,
    asMetadata,
    resourceUrl: serverUrl.replace(/\/$/, ""),
    asBaseUrl,
  };
}

/** Try /.well-known/oauth-protected-resource with path, then root (RFC 9728). */
async function fetchResourceMetadataFromWellKnown(serverUrl: string): Promise<OAuthProtectedResourceMetadata> {
  const base = new URL(serverUrl).origin;
  const path = new URL(serverUrl).pathname.replace(/\/?$/, "") || "/";
  const candidates = [
    `${base}/.well-known/oauth-protected-resource${path}`,
    `${base}/.well-known/oauth-protected-resource`,
  ];
  let lastErr: Error | null = null;
  for (const url of candidates) {
    try {
      const res = await fetch(url, { method: "GET", credentials: "omit" });
      if (res.ok) return (await res.json()) as OAuthProtectedResourceMetadata;
      if (res.status === 404) continue;
      throw new Error(`Resource metadata fetch failed: ${res.status} ${url}`);
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
    }
  }
  throw lastErr ?? new Error(`Resource metadata not found at ${candidates.join(" or ")}`);
}

/** Alias for discoverFrom401 for use when handling MCPAuthRequiredError. */
export const discoverFrom401Response = discoverFrom401;

/** Discover from server config: request server (or well-known), on 401 use discoverFrom401. */
export async function discoverFromConfig(config: MCPServerConfig): Promise<OAuthDiscoveryResult> {
  const baseUrl = config.url?.replace(/\/$/, "") ?? "";
  if (!baseUrl) throw new Error("MCP server URL required for OAuth discovery");
  const candidates = [
    baseUrl,
    `${baseUrl}/.well-known/oauth-protected-resource`,
    `${baseUrl}/.well-known/oauth-protected-resource/`,
  ];
  for (const url of candidates) {
    try {
      const res = await fetch(url, { method: "GET", credentials: "omit" });
      if (res.status === 401) return discoverFrom401(res, baseUrl);
      if (res.ok) {
        const meta = (await res.json()) as OAuthProtectedResourceMetadata;
        const authServers = meta.authorization_servers;
        if (!authServers?.length) continue;
        const asMetadata = await fetchAuthorizationServerMetadata(authServers[0]);
        return {
          resourceMetadata: meta,
          asMetadata,
          resourceUrl: baseUrl,
          asBaseUrl: authServers[0],
        };
      }
    } catch {
      /* try next */
    }
  }
  throw new Error(`OAuth discovery failed for ${baseUrl}`);
}

function generateState(): string {
  return crypto.randomUUID();
}

async function generatePkce(): Promise<{ verifier: string; challenge: string; method: string }> {
  const verifierBytes = new Uint8Array(32);
  crypto.getRandomValues(verifierBytes);
  const verifier = btoa(String.fromCharCode(...verifierBytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
    .slice(0, 43);
  const encoder = new TextEncoder();
  const hash = await crypto.subtle.digest("SHA-256", encoder.encode(verifier));
  const challenge = btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return { verifier, challenge, method: "S256" };
}

type PendingOAuth = {
  serverId: string;
  code_verifier: string;
  token_endpoint: string;
  resource: string;
  client_id: string;
  redirect_uri: string;
};

function getPendingState(): Record<string, PendingOAuth> {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    return raw ? (JSON.parse(raw) as Record<string, PendingOAuth>) : {};
  } catch {
    return {};
  }
}

function setPendingState(state: string, pending: PendingOAuth): void {
  const all = getPendingState();
  all[state] = pending;
  localStorage.setItem(PENDING_KEY, JSON.stringify(all));
}

function clearPendingState(state: string): void {
  const all = getPendingState();
  delete all[state];
  localStorage.setItem(PENDING_KEY, JSON.stringify(all));
}

/** Get redirect_uri for MCP OAuth callback (SPA origin + path). */
export function getMcpOAuthRedirectUri(): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}${withMountPath("/oauth/mcp-callback")}`;
}

/** URL of our MCP OAuth Client ID Metadata Document (for client_id when using public client). */
export function getMcpClientMetadataUrl(): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}${withMountPath("/oauth/mcp-client-metadata")}`;
}

type DynamicClientRegistrationResponse = {
  client_id?: string;
};

export async function resolveOAuthClientId(
  config: MCPServerConfig,
  discovery: OAuthDiscoveryResult,
  redirectUri: string
): Promise<string> {
  if (config.oauthClientMetadataUrl) return config.oauthClientMetadataUrl;
  if (config.oauthClientId) return config.oauthClientId;

  const registrationEndpoint = discovery.asMetadata.registration_endpoint;
  if (registrationEndpoint) {
    try {
      const res = await fetch(registrationEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "omit",
        body: JSON.stringify({
          client_name: config.name?.trim() || "MCP Client",
          redirect_uris: [redirectUri],
          grant_types: ["authorization_code", "refresh_token"],
          token_endpoint_auth_method: "none",
        }),
      });
      if (res.ok) {
        const payload = (await res.json()) as DynamicClientRegistrationResponse;
        if (payload.client_id && payload.client_id.trim()) return payload.client_id;
      }
    } catch {
      // Ignore and fall back to metadata URL / issuer.
    }
  }

  return getMcpClientMetadataUrl() || discovery.asMetadata.issuer || discovery.asBaseUrl;
}

/** Start OAuth: build auth URL, then redirect or open popup. When usePopup is true, returns a Promise that resolves when the popup completes OAuth. */
export type StartOAuthOptions = {
  redirectUri?: string;
  /** If true, open auth in a popup and resolve when callback posts message (no redirect of current page). */
  usePopup?: boolean;
};

export async function startOAuth(
  config: MCPServerConfig,
  discovery: OAuthDiscoveryResult,
  options?: StartOAuthOptions | string
): Promise<void> {
  const redirectUri = typeof options === "string" ? options : options?.redirectUri;
  const usePopup = typeof options === "object" && options?.usePopup === true;
  const redirect = redirectUri ?? getMcpOAuthRedirectUri();
  const clientId = await resolveOAuthClientId(config, discovery, redirect);
  const scope =
    discovery.resourceMetadata.scopes_supported?.join(" ") ??
    discovery.asMetadata.scopes_supported?.join(" ") ??
    "";
  const resource = discovery.resourceUrl;
  const state = generateState();
  const { verifier, challenge, method } = await generatePkce();

  setPendingState(state, {
    serverId: config.id,
    code_verifier: verifier,
    token_endpoint: discovery.asMetadata.token_endpoint,
    resource,
    client_id: clientId,
    redirect_uri: redirect,
  });

  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirect,
    state,
    code_challenge: challenge,
    code_challenge_method: method,
    resource,
  });
  if (scope) params.set("scope", scope);

  const authUrl = `${discovery.asMetadata.authorization_endpoint}?${params.toString()}`;

  if (usePopup) {
    return startOAuthPopup(authUrl);
  }
  window.location.href = authUrl;
}

const MCP_OAUTH_POPUP_NAME = "mcp-oauth";
const MCP_OAUTH_POPUP_FEATURES = "width=520,height=640,scrollbars=yes,resizable=yes";

function startOAuthPopup(authUrl: string): Promise<void> {
  const popup = window.open(authUrl, MCP_OAUTH_POPUP_NAME, MCP_OAUTH_POPUP_FEATURES);
  if (!popup) {
    return Promise.reject(new Error("Popup blocked. Please allow popups for this site and try again."));
  }
  return new Promise<void>((resolve, reject) => {
    let messageReceived = false;
    const handler = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      const d = e.data;
      if (d?.type === "mcp-oauth-done") {
        console.log("[MCP OAuth] opener: received mcp-oauth-done serverId=%s", d.serverId);
        messageReceived = true;
        cleanup();
        resolve();
      }
      if (d?.type === "mcp-oauth-error") {
        console.log("[MCP OAuth] opener: received mcp-oauth-error", d.error);
        messageReceived = true;
        cleanup();
        reject(new Error(d.error ?? "OAuth failed"));
      }
    };
    const cleanup = () => {
      window.removeEventListener("message", handler);
      clearInterval(timer);
    };
    window.addEventListener("message", handler);
    const timer = setInterval(() => {
      if (popup.closed && !messageReceived) {
        cleanup();
        reject(new Error("OAuth cancelled"));
      }
    }, 200);
  });
}

/** Exchange code for token; save to IndexedDB; clear pending only after success (so double effect run still sees state). */
export async function exchangeCode(state: string, code: string): Promise<{ serverId: string }> {
  const pending = getPendingState()[state];
  console.log("[MCP OAuth] exchangeCode: state=%s pending=%s", state.slice(0, 8), !!pending);
  if (!pending) throw new Error("Invalid or expired OAuth state");

  if (exchangeInFlight.has(state)) {
    console.log("[MCP OAuth] exchangeCode: duplicate run for state=%s, waiting for token...", state.slice(0, 8));
    const { getMCPToken } = await import("./mcp-oauth-tokens.ts");
    for (let i = 0; i < 25; i++) {
      await new Promise((r) => setTimeout(r, 200));
      const existing = await getMCPToken(pending.serverId);
      if (existing?.access_token) {
        clearPendingState(state);
        return { serverId: pending.serverId };
      }
    }
    throw new Error("OAuth timed out (duplicate request)");
  }
  exchangeInFlight.add(state);
  try {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: pending.redirect_uri,
      client_id: pending.client_id,
      code_verifier: pending.code_verifier,
      resource: pending.resource,
    });

    const res = await fetch(pending.token_endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      credentials: "omit",
    });
    if (!res.ok) {
      const text = await res.text();
      if (res.status === 400) {
        try {
          const json = JSON.parse(text) as { error?: string };
          if (json.error === "invalid_grant") {
            await new Promise((r) => setTimeout(r, 400));
            const { getMCPToken } = await import("./mcp-oauth-tokens.ts");
            const existing = await getMCPToken(pending.serverId);
            if (existing?.access_token) {
              console.log("[MCP OAuth] exchangeCode: invalid_grant but token already saved (duplicate run), serverId=%s", pending.serverId);
              clearPendingState(state);
              return { serverId: pending.serverId };
            }
          }
        } catch {
          /* ignore */
        }
      }
      throw new Error(`Token exchange failed: ${res.status} ${text}`);
    }
    const data = (await res.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
    };
    const expiresAt = data.expires_in
      ? Date.now() + data.expires_in * 1000
      : Date.now() + 3600 * 1000;
    console.log("[MCP OAuth] exchangeCode: saving token serverId=%s expiresAt=%s", pending.serverId, new Date(expiresAt).toISOString());
    await setMCPToken({
      serverId: pending.serverId,
      access_token: data.access_token,
      expires_at: expiresAt,
      refresh_token: data.refresh_token,
      updatedAt: Date.now(),
    });
    clearPendingState(state);
    return { serverId: pending.serverId };
  } finally {
    exchangeInFlight.delete(state);
  }
}

/** Check if we have pending OAuth state (e.g. for callback page). */
export function getPendingByState(state: string): PendingOAuth | null {
  return getPendingState()[state] ?? null;
}
