import type { CognitoConfig, CognitoRefreshedTokenSet, CognitoTokenSet } from "./types.ts";

type CognitoTokenResponse = {
  access_token: string;
  id_token: string;
  refresh_token?: string;
  token_type: string;
  expires_in: number;
};

export async function exchangeCodeForTokens(
  config: CognitoConfig,
  code: string,
  redirectUri: string
): Promise<CognitoTokenSet> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: config.clientId,
    code,
    redirect_uri: redirectUri,
  });
  if (config.clientSecret) body.set("client_secret", config.clientSecret);

  const res = await fetch(`${config.hostedUiUrl}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Cognito token exchange failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as CognitoTokenResponse;
  if (!data.refresh_token) {
    throw new Error("Cognito did not return a refresh_token for authorization_code grant");
  }
  return {
    idToken: data.id_token,
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Math.floor(Date.now() / 1000) + data.expires_in,
  };
}

export async function refreshCognitoTokens(
  config: CognitoConfig,
  refreshToken: string
): Promise<CognitoRefreshedTokenSet> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: config.clientId,
    refresh_token: refreshToken,
  });
  if (config.clientSecret) body.set("client_secret", config.clientSecret);

  const res = await fetch(`${config.hostedUiUrl}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Cognito token refresh failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as CognitoTokenResponse;
  return {
    idToken: data.id_token,
    accessToken: data.access_token,
    expiresAt: Math.floor(Date.now() / 1000) + data.expires_in,
  };
}

export function buildCognitoAuthorizeUrl(
  config: CognitoConfig,
  params: {
    redirectUri: string;
    state: string;
    scope: string | null;
    identityProvider: string | null;
  }
): string {
  const query = new URLSearchParams({
    client_id: config.clientId,
    response_type: "code",
    redirect_uri: params.redirectUri,
    state: params.state,
  });
  if (params.scope) query.set("scope", params.scope);
  if (params.identityProvider) query.set("identity_provider", params.identityProvider);
  return `${config.hostedUiUrl}/oauth2/authorize?${query}`;
}
