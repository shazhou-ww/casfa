/**
 * Authorization Code Lifecycle
 *
 * Validate authorization requests, create authorization codes,
 * and consume codes with PKCE verification.
 */

import { verifyPkceChallenge } from "@casfa/client-auth-crypto";
import { isRedirectUriAllowed } from "./redirect-uri.ts";
import { validateScopes } from "./scope.ts";
import type {
  AuthCodeStore,
  AuthorizationCode,
  AuthorizationRequestParams,
  OAuthClient,
  Result,
  ValidatedAuthRequest,
} from "./types.ts";

// ============================================================================
// Authorization Request Validation
// ============================================================================

/**
 * Dependencies for {@link validateAuthorizationRequest}.
 */
export type ValidateAuthRequestDeps = {
  /** Function to resolve a client by ID */
  resolveClient: (clientId: string) => Promise<OAuthClient | null>;
  /** List of scope identifiers supported by this server */
  supportedScopes: string[];
};

/**
 * Validate an authorization request's query parameters.
 *
 * Checks (in order):
 * 1. `response_type` must be `"code"`
 * 2. `client_id` must resolve to a known client
 * 3. `redirect_uri` must match the client's registered patterns
 * 4. `scope` must be non-empty and all scopes must be supported
 * 5. PKCE `code_challenge` must be present with `code_challenge_method=S256`
 *
 * @param params - Raw query parameters from `GET /authorize`
 * @param deps - Client resolver and scope configuration
 * @returns Validated request ready for the consent UI, or an error
 *
 * @example
 * ```ts
 * const result = await validateAuthorizationRequest(
 *   { responseType: "code", clientId: "my-app", redirectUri: "...", ... },
 *   { resolveClient: (id) => resolveClient(id, store, known), supportedScopes: ["read", "write"] },
 * );
 * if (result.ok) {
 *   // Show consent page with result.value.client, result.value.scopes, etc.
 * }
 * ```
 */
export async function validateAuthorizationRequest(
  params: AuthorizationRequestParams,
  deps: ValidateAuthRequestDeps
): Promise<Result<ValidatedAuthRequest>> {
  // 1. response_type must be "code"
  if (params.responseType !== "code") {
    return {
      ok: false,
      error: {
        code: "unsupported_response_type",
        message: "Only 'code' response type is supported",
        statusCode: 400,
      },
    };
  }

  // 2. Resolve client
  if (!params.clientId) {
    return {
      ok: false,
      error: { code: "invalid_request", message: "Missing client_id", statusCode: 400 },
    };
  }
  const client = await deps.resolveClient(params.clientId);
  if (!client) {
    return {
      ok: false,
      error: { code: "invalid_client", message: "Unknown client_id", statusCode: 400 },
    };
  }

  // 3. Validate redirect_uri
  if (!params.redirectUri) {
    return {
      ok: false,
      error: { code: "invalid_request", message: "Missing redirect_uri", statusCode: 400 },
    };
  }
  if (!isRedirectUriAllowed(params.redirectUri, client.redirectUris)) {
    return {
      ok: false,
      error: {
        code: "invalid_request",
        message: "redirect_uri not allowed for this client",
        statusCode: 400,
      },
    };
  }

  // 4. Validate scopes
  if (!params.scope) {
    return {
      ok: false,
      error: { code: "invalid_request", message: "Missing scope", statusCode: 400 },
    };
  }
  const scopes = params.scope.split(" ").filter(Boolean);
  const scopeResult = validateScopes(scopes, deps.supportedScopes);
  if (!scopeResult.ok) return scopeResult;

  // 5. Validate PKCE
  if (!params.codeChallenge || params.codeChallengeMethod !== "S256") {
    return {
      ok: false,
      error: {
        code: "invalid_request",
        message: "PKCE required: code_challenge with method S256",
        statusCode: 400,
      },
    };
  }

  return {
    ok: true,
    value: {
      client,
      redirectUri: params.redirectUri,
      scopes: scopeResult.value,
      codeChallenge: params.codeChallenge,
      state: params.state,
    },
  };
}

// ============================================================================
// Authorization Code Creation
// ============================================================================

/** Default authorization code TTL: 10 minutes */
const DEFAULT_CODE_TTL_MS = 10 * 60 * 1000;

/**
 * Parameters for {@link createAuthorizationCode}.
 */
export type CreateAuthCodeParams<TGrant> = {
  /** Client that initiated the authorization */
  clientId: string;
  /** Validated redirect URI */
  redirectUri: string;
  /** User identifier who approved the authorization */
  subject: string;
  /** Approved scopes */
  scopes: string[];
  /** PKCE code challenge */
  codeChallenge: string;
  /** Business-specific permissions */
  grantedPermissions: TGrant;
  /** Code TTL in milliseconds (default: 600_000 = 10 minutes) */
  ttlMs?: number;
};

/**
 * Generate a random authorization code string.
 *
 * Produces 16 random bytes, encoded as URL-safe base64 (22 characters).
 */
function generateCode(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  // Convert to base64url
  let binary = "";
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Create an authorization code record.
 *
 * Generates a cryptographically random code and packages it with
 * the authorization parameters. The returned record is an in-memory
 * object — call `store.save()` to persist it.
 *
 * @param params - Authorization parameters
 * @returns Authorization code record (not yet persisted)
 *
 * @example
 * ```ts
 * const code = createAuthorizationCode({
 *   clientId: "my-app",
 *   redirectUri: "http://localhost:3000/callback",
 *   subject: "usr_123",
 *   scopes: ["cas:read", "cas:write"],
 *   codeChallenge: challenge,
 *   grantedPermissions: { canUpload: true },
 * });
 * await store.save(code);
 * ```
 */
export function createAuthorizationCode<TGrant>(
  params: CreateAuthCodeParams<TGrant>
): AuthorizationCode<TGrant> {
  const now = Date.now();
  const ttl = params.ttlMs ?? DEFAULT_CODE_TTL_MS;

  return {
    code: generateCode(),
    clientId: params.clientId,
    redirectUri: params.redirectUri,
    subject: params.subject,
    scopes: params.scopes,
    codeChallenge: params.codeChallenge,
    codeChallengeMethod: "S256",
    grantedPermissions: params.grantedPermissions,
    createdAt: now,
    expiresAt: now + ttl,
  };
}

// ============================================================================
// Authorization Code Consumption + PKCE Verification
// ============================================================================

/**
 * Atomically consume an authorization code and verify PKCE.
 *
 * Steps:
 * 1. Call `store.consume(code)` — atomic retrieval + mark-as-used
 * 2. Check the code has not expired
 * 3. Verify `SHA-256(code_verifier) === code_challenge`
 *
 * On success, returns the full authorization code record (including
 * `grantedPermissions`). The code cannot be used again.
 *
 * @param code - Authorization code string from the client
 * @param codeVerifier - PKCE code_verifier from the client
 * @param store - Authorization code storage (must implement atomic consume)
 * @returns Consumed authorization code record, or an error
 *
 * @example
 * ```ts
 * const result = await consumeAuthorizationCode(code, codeVerifier, store);
 * if (result.ok) {
 *   const { subject, scopes, grantedPermissions } = result.value;
 *   // Issue tokens...
 * }
 * ```
 */
export async function consumeAuthorizationCode<TGrant>(
  code: string,
  codeVerifier: string,
  store: AuthCodeStore<TGrant>
): Promise<Result<AuthorizationCode<TGrant>>> {
  // 1. Atomically consume
  const authCode = await store.consume(code);
  if (!authCode) {
    return {
      ok: false,
      error: {
        code: "invalid_grant",
        message: "Invalid, expired, or already used authorization code",
        statusCode: 400,
      },
    };
  }

  // 2. Check expiration
  if (authCode.expiresAt < Date.now()) {
    return {
      ok: false,
      error: {
        code: "invalid_grant",
        message: "Authorization code has expired",
        statusCode: 400,
      },
    };
  }

  // 3. Verify PKCE: SHA-256(code_verifier) === code_challenge
  const pkceValid = await verifyPkceChallenge(codeVerifier, authCode.codeChallenge);
  if (!pkceValid) {
    return {
      ok: false,
      error: {
        code: "invalid_grant",
        message: "PKCE verification failed",
        statusCode: 400,
      },
    };
  }

  return { ok: true, value: authCode };
}
