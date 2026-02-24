/**
 * IdP Client
 *
 * Functions for interacting with an OIDC Identity Provider:
 * - Build authorization URLs
 * - Exchange authorization codes for tokens
 * - Refresh tokens
 *
 * All functions are framework-agnostic and use the Fetch API.
 */

import type { IdpConfig, IdpTokenSet, Result } from "./types.ts";

// ============================================================================
// Authorization URL
// ============================================================================

/**
 * Parameters for building an authorization URL.
 */
export type AuthorizationUrlParams = {
  /** Callback URL where the IdP will redirect after authentication */
  redirectUri: string;
  /** Space-separated scope string (e.g. "openid email profile") */
  scope: string;
  /** CSRF protection state parameter */
  state: string;
  /** PKCE code_challenge (base64url-encoded SHA-256 hash) */
  codeChallenge: string;
  /** Code challenge method (default: "S256") */
  codeChallengeMethod?: string;
  /**
   * Extra query parameters to append.
   * Useful for provider-specific params like Cognito's `identity_provider`.
   *
   * @example
   * ```ts
   * { identity_provider: "Google" }
   * ```
   */
  extraParams?: Record<string, string>;
};

/**
 * Build an IdP authorization URL for the Authorization Code + PKCE flow.
 *
 * Constructs the full URL with all required query parameters.
 * Does not make any network requests.
 *
 * @param config - IdP endpoint configuration
 * @param params - Authorization request parameters
 * @returns Full authorization URL string
 *
 * @example
 * ```ts
 * const url = buildAuthorizationUrl(cognitoConfig, {
 *   redirectUri: "https://app.example.com/callback",
 *   scope: "openid email profile",
 *   state: crypto.randomUUID(),
 *   codeChallenge: await generateCodeChallenge(verifier),
 *   extraParams: { identity_provider: "Google" },
 * });
 * // Redirect user to `url`
 * ```
 */
export function buildAuthorizationUrl(config: IdpConfig, params: AuthorizationUrlParams): string {
  const url = new URL(config.authorizationEndpoint);

  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("scope", params.scope);
  url.searchParams.set("state", params.state);
  url.searchParams.set("code_challenge", params.codeChallenge);
  url.searchParams.set("code_challenge_method", params.codeChallengeMethod ?? "S256");

  if (params.extraParams) {
    for (const [key, value] of Object.entries(params.extraParams)) {
      url.searchParams.set(key, value);
    }
  }

  return url.toString();
}

// ============================================================================
// Authorization Code Exchange
// ============================================================================

/**
 * Exchange an authorization code for tokens at the IdP's token endpoint.
 *
 * Sends a `POST` with `grant_type=authorization_code` using
 * `application/x-www-form-urlencoded` encoding, per OAuth 2.0/2.1 spec.
 *
 * @param config - IdP endpoint configuration
 * @param params - Code exchange parameters
 * @returns Token set from the IdP, or an error
 *
 * @example
 * ```ts
 * const result = await exchangeAuthorizationCode(cognitoConfig, {
 *   code: "abc123",
 *   redirectUri: "https://app.example.com/callback",
 *   codeVerifier: storedVerifier,
 * });
 * if (result.ok) {
 *   // result.value.accessToken, result.value.idToken, etc.
 * }
 * ```
 */
export async function exchangeAuthorizationCode(
  config: IdpConfig,
  params: {
    /** Authorization code received from the IdP callback */
    code: string;
    /** Must match the redirect_uri used in the authorization request */
    redirectUri: string;
    /** PKCE code_verifier (if PKCE was used) */
    codeVerifier?: string;
  }
): Promise<Result<IdpTokenSet>> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: config.clientId,
    code: params.code,
    redirect_uri: params.redirectUri,
  });

  if (params.codeVerifier) {
    body.set("code_verifier", params.codeVerifier);
  }
  if (config.clientSecret) {
    body.set("client_secret", config.clientSecret);
  }

  return fetchTokenEndpoint(config.tokenEndpoint, body);
}

// ============================================================================
// Token Refresh
// ============================================================================

/**
 * Refresh tokens at the IdP's token endpoint.
 *
 * Sends a `POST` with `grant_type=refresh_token`.
 *
 * @param config - IdP endpoint configuration
 * @param refreshToken - The refresh token to exchange
 * @returns New token set from the IdP, or an error
 */
export async function refreshIdpToken(
  config: IdpConfig,
  refreshToken: string
): Promise<Result<IdpTokenSet>> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: config.clientId,
    refresh_token: refreshToken,
  });

  if (config.clientSecret) {
    body.set("client_secret", config.clientSecret);
  }

  return fetchTokenEndpoint(config.tokenEndpoint, body);
}

// ============================================================================
// Internal: Token Endpoint Request
// ============================================================================

/**
 * Raw IdP token response shape (snake_case per OAuth spec).
 */
type RawIdpTokenResponse = {
  access_token: string;
  id_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type: string;
  error?: string;
  error_description?: string;
};

/**
 * Send a POST to a token endpoint and parse the response.
 */
async function fetchTokenEndpoint(
  tokenEndpoint: string,
  body: URLSearchParams
): Promise<Result<IdpTokenSet>> {
  let response: Response;
  try {
    response = await fetch(tokenEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
  } catch (err) {
    return {
      ok: false,
      error: {
        code: "network_error",
        message: `Failed to reach token endpoint: ${err instanceof Error ? err.message : String(err)}`,
        statusCode: 502,
      },
    };
  }

  let data: RawIdpTokenResponse;
  try {
    data = (await response.json()) as RawIdpTokenResponse;
  } catch {
    return {
      ok: false,
      error: {
        code: "token_exchange_failed",
        message: `Token endpoint returned invalid JSON (HTTP ${response.status})`,
        statusCode: 502,
      },
    };
  }

  if (!response.ok || data.error) {
    return {
      ok: false,
      error: {
        code: "token_exchange_failed",
        message: data.error_description ?? data.error ?? `HTTP ${response.status}`,
        statusCode: response.status,
      },
    };
  }

  if (!data.access_token) {
    return {
      ok: false,
      error: {
        code: "token_exchange_failed",
        message: "Token endpoint response missing access_token",
        statusCode: 502,
      },
    };
  }

  return {
    ok: true,
    value: {
      accessToken: data.access_token,
      idToken: data.id_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
      tokenType: data.token_type,
    },
  };
}
