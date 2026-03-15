export type OAuthProtectedResourceMetadata = {
  authorization_servers?: string[];
  scopes_supported?: string[];
};

export type OAuthAuthorizationServerMetadata = {
  issuer?: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
  scopes_supported?: string[];
};

export type PendingServerOAuth = {
  state: string;
  userId: string;
  serverId: string;
  tokenEndpoint: string;
  resource: string;
  clientId: string;
  redirectUri: string;
  codeVerifier: string;
  returnUrl: string;
  usePopup: boolean;
  expiresAt: number;
};

function base64UrlEncode(input: Uint8Array): string {
  const b64 = Buffer.from(input).toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function generatePkce(): Promise<{ verifier: string; challenge: string; method: "S256" }> {
  const verifierBytes = new Uint8Array(32);
  crypto.getRandomValues(verifierBytes);
  const verifier = base64UrlEncode(verifierBytes).slice(0, 64);
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const challenge = base64UrlEncode(new Uint8Array(hash));
  return { verifier, challenge, method: "S256" };
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { method: "GET" });
  if (!res.ok) throw new Error(`GET ${url} failed: ${res.status}`);
  return (await res.json()) as T;
}

async function fetchResourceMetadata(resourceUrl: string): Promise<OAuthProtectedResourceMetadata> {
  const u = new URL(resourceUrl);
  const path = u.pathname.replace(/\/?$/, "") || "/";
  const candidates = [
    `${u.origin}/.well-known/oauth-protected-resource${path}`,
    `${u.origin}/.well-known/oauth-protected-resource`,
  ];
  let lastError: Error | null = null;
  for (const candidate of candidates) {
    try {
      return await fetchJson<OAuthProtectedResourceMetadata>(candidate);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }
  throw lastError ?? new Error("OAuth protected resource metadata not found");
}

export async function isOAuthProtectedResource(resourceUrl: string): Promise<boolean> {
  try {
    const metadata = await fetchResourceMetadata(resourceUrl);
    return Array.isArray(metadata.authorization_servers) && metadata.authorization_servers.length > 0;
  } catch {
    return false;
  }
}

async function fetchAuthorizationServerMetadata(
  issuerOrBaseUrl: string
): Promise<OAuthAuthorizationServerMetadata> {
  const issuer = new URL(issuerOrBaseUrl);
  const issuerPath = issuer.pathname.replace(/\/+$/, "");
  const rfc8414 = `${issuer.origin}/.well-known/oauth-authorization-server${issuerPath || ""}`;
  const base = issuerOrBaseUrl.replace(/\/$/, "");
  const candidates = [
    rfc8414,
    `${base}/.well-known/openid-configuration`,
    `${base}/.well-known/oauth-authorization-server`,
  ];
  let lastError: Error | null = null;
  for (const candidate of candidates) {
    try {
      return await fetchJson<OAuthAuthorizationServerMetadata>(candidate);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }
  throw lastError ?? new Error("OAuth authorization server metadata not found");
}

export async function discoverServerOAuth(resourceUrl: string): Promise<{
  resource: OAuthProtectedResourceMetadata;
  authorizationServer: OAuthAuthorizationServerMetadata;
}> {
  const resource = await fetchResourceMetadata(resourceUrl);
  const asBase = resource.authorization_servers?.[0];
  if (!asBase) throw new Error("No authorization server advertised by resource");
  const authorizationServer = await fetchAuthorizationServerMetadata(asBase);
  return { resource, authorizationServer };
}

export function normalizeReturnUrl(input: string | undefined, gatewayBaseUrl: string): string {
  if (!input) return gatewayBaseUrl;
  try {
    const base = new URL(gatewayBaseUrl);
    const resolved = new URL(input, gatewayBaseUrl);
    if (resolved.origin !== base.origin) return gatewayBaseUrl;
    return resolved.toString();
  } catch {
    return gatewayBaseUrl;
  }
}

type DynamicClientRegistrationResponse = {
  client_id?: string;
};

export async function resolveOAuthClientId(params: {
  authorizationServer: OAuthAuthorizationServerMetadata;
  redirectUri: string;
  clientName: string;
  fallbackClientId: string;
}): Promise<string> {
  const endpoint = params.authorizationServer.registration_endpoint;
  if (endpoint) {
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_name: params.clientName,
          redirect_uris: [params.redirectUri],
          grant_types: ["authorization_code", "refresh_token"],
          token_endpoint_auth_method: "none",
        }),
      });
      if (res.ok) {
        const payload = (await res.json()) as DynamicClientRegistrationResponse;
        if (payload.client_id && payload.client_id.trim()) {
          return payload.client_id.trim();
        }
      }
    } catch {
      // Fall back to metadata URL client_id.
    }
  }
  return params.fallbackClientId;
}
