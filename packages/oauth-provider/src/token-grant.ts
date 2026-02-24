/**
 * Token Grant Handler
 *
 * Unified handler for the OAuth token endpoint (`POST /token`).
 * Dispatches by `grant_type`:
 * - `authorization_code` → consume code + PKCE verify + issue tokens
 * - `refresh_token` → delegate to TokenIssuer
 */

import { consumeAuthorizationCode } from "./authorization.ts";
import type {
  AuthCodeStore,
  Result,
  TokenIssuer,
  TokenRequestParams,
  TokenResponse,
} from "./types.ts";

// ============================================================================
// Token Request Handler
// ============================================================================

/**
 * Dependencies for {@link handleTokenRequest}.
 */
export type TokenRequestDeps<TGrant> = {
  /** Authorization code storage */
  authCodeStore: AuthCodeStore<TGrant>;
  /** Business-specific token issuer */
  tokenIssuer: TokenIssuer<TGrant>;
  /** Supported grant types (used for validation) */
  supportedGrantTypes: string[];
};

/**
 * Handle a token endpoint request.
 *
 * Validates the `grant_type`, dispatches to the appropriate handler,
 * and returns a standard OAuth token response.
 *
 * For `authorization_code`:
 * 1. Validates required parameters (`code`, `redirect_uri`, `client_id`, `code_verifier`)
 * 2. Atomically consumes the authorization code
 * 3. Verifies `redirect_uri` and `client_id` match
 * 4. Verifies PKCE
 * 5. Delegates to `tokenIssuer.issueFromAuthCode()`
 *
 * For `refresh_token`:
 * 1. Validates `refresh_token` is present
 * 2. Delegates to `tokenIssuer.issueFromRefresh()`
 *
 * @param params - Parsed request body parameters
 * @param deps - Storage, issuer, and configuration
 * @returns Standard OAuth token response, or an error
 *
 * @example
 * ```ts
 * app.post("/oauth/token", async (c) => {
 *   const body = await c.req.parseBody();
 *   const result = await handleTokenRequest(
 *     { grantType: body.grant_type, code: body.code, ... },
 *     { authCodeStore, tokenIssuer, supportedGrantTypes: ["authorization_code", "refresh_token"] },
 *   );
 *   if (!result.ok) return c.json(result.error, result.error.statusCode);
 *   return c.json(result.value);
 * });
 * ```
 */
export async function handleTokenRequest<TGrant>(
  params: TokenRequestParams,
  deps: TokenRequestDeps<TGrant>
): Promise<Result<TokenResponse>> {
  // Validate grant_type
  if (!params.grantType) {
    return {
      ok: false,
      error: { code: "invalid_request", message: "Missing grant_type", statusCode: 400 },
    };
  }

  if (!deps.supportedGrantTypes.includes(params.grantType)) {
    return {
      ok: false,
      error: {
        code: "unsupported_grant_type",
        message: `Unsupported grant_type: ${params.grantType}`,
        statusCode: 400,
      },
    };
  }

  switch (params.grantType) {
    case "authorization_code":
      return handleAuthorizationCodeGrant(params, deps);
    case "refresh_token":
      return handleRefreshTokenGrant(params, deps);
    default:
      return {
        ok: false,
        error: {
          code: "unsupported_grant_type",
          message: `Unsupported grant_type: ${params.grantType}`,
          statusCode: 400,
        },
      };
  }
}

// ============================================================================
// Authorization Code Grant
// ============================================================================

async function handleAuthorizationCodeGrant<TGrant>(
  params: TokenRequestParams,
  deps: TokenRequestDeps<TGrant>
): Promise<Result<TokenResponse>> {
  const { code, redirectUri, clientId, codeVerifier } = params;

  // Validate required parameters
  if (!code || !redirectUri || !clientId || !codeVerifier) {
    return {
      ok: false,
      error: {
        code: "invalid_request",
        message: "Missing required parameters: code, redirect_uri, client_id, code_verifier",
        statusCode: 400,
      },
    };
  }

  // Consume and verify PKCE
  const consumeResult = await consumeAuthorizationCode(code, codeVerifier, deps.authCodeStore);
  if (!consumeResult.ok) return consumeResult;

  const authCode = consumeResult.value;

  // Verify redirect_uri matches
  if (authCode.redirectUri !== redirectUri) {
    return {
      ok: false,
      error: { code: "invalid_grant", message: "redirect_uri mismatch", statusCode: 400 },
    };
  }

  // Verify client_id matches
  if (authCode.clientId !== clientId) {
    return {
      ok: false,
      error: { code: "invalid_grant", message: "client_id mismatch", statusCode: 400 },
    };
  }

  // Delegate to business logic
  return deps.tokenIssuer.issueFromAuthCode({
    subject: authCode.subject,
    clientId: authCode.clientId,
    scopes: authCode.scopes,
    grantedPermissions: authCode.grantedPermissions,
  });
}

// ============================================================================
// Refresh Token Grant
// ============================================================================

async function handleRefreshTokenGrant<TGrant>(
  params: TokenRequestParams,
  deps: TokenRequestDeps<TGrant>
): Promise<Result<TokenResponse>> {
  if (!params.refreshToken) {
    return {
      ok: false,
      error: { code: "invalid_request", message: "Missing refresh_token", statusCode: 400 },
    };
  }

  return deps.tokenIssuer.issueFromRefresh({
    refreshToken: params.refreshToken,
  });
}
