export type CognitoConfig = {
  region: string;
  userPoolId: string;
  clientId: string;
  hostedUiUrl: string;
};

export type CognitoTokenResponse = {
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
): Promise<CognitoTokenResponse> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: config.clientId,
    code,
    redirect_uri: redirectUri,
  });

  const res = await fetch(`${config.hostedUiUrl}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Cognito token exchange failed (${res.status}): ${text}`);
  }
  return res.json();
}

export async function refreshCognitoTokens(
  config: CognitoConfig,
  refreshToken: string
): Promise<CognitoTokenResponse> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: config.clientId,
    refresh_token: refreshToken,
  });

  const res = await fetch(`${config.hostedUiUrl}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Cognito token refresh failed (${res.status}): ${text}`);
  }
  return res.json();
}
