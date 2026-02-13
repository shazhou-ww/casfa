/**
 * OAuth Auth Controller
 *
 * Handles MCP OAuth 2.1 Authorization Code + PKCE flow.
 * Uses /api/auth/* routes (not /api/oauth/* which is Cognito proxy).
 *
 * Endpoints:
 * - GET /.well-known/oauth-authorization-server/api/auth — RFC 8414 metadata
 * - GET /api/auth/authorize — Authorization endpoint (validates params, shows consent page)
 * - POST /api/auth/authorize — User approves authorization (requires JWT)
 * - POST /api/auth/token — Token endpoint (code exchange + refresh)
 */

import { createHash, randomBytes } from "node:crypto";
import type { Delegate } from "@casfa/delegate";
import type { Context } from "hono";
import type { ServerConfig } from "../config.ts";
import type { AuthCodesDb, GrantedPermissions } from "../db/auth-codes.ts";
import type { DelegatesDb } from "../db/delegates.ts";
import { RefreshError, refreshDelegateToken } from "../services/delegate-refresh.ts";
import type { Env, JwtAuthContext } from "../types.ts";
import { generateTokenPair } from "../util/delegate-token-utils.ts";
import { generateDelegateId } from "../util/token-id.ts";

// ============================================================================
// Types
// ============================================================================

export type OAuthAuthControllerDeps = {
  serverConfig: ServerConfig;
  authCodesDb: AuthCodesDb;
  delegatesDb: DelegatesDb;
};

export type OAuthAuthController = {
  /** GET /.well-known/oauth-authorization-server/api/auth */
  getMetadata: (c: Context<Env>) => Response;
  /** GET /api/auth/authorize — validate params, show consent page */
  authorize: (c: Context<Env>) => Promise<Response>;
  /** POST /api/auth/authorize — user approves, generates code and redirects */
  approveAuthorization: (c: Context<Env>) => Promise<Response>;
  /** POST /api/auth/token — exchange code or refresh token */
  token: (c: Context<Env>) => Promise<Response>;
};

// ============================================================================
// Constants
// ============================================================================

/** Authorization code validity: 10 minutes */
const AUTH_CODE_TTL_MS = 10 * 60 * 1000;

/** Default access token TTL: 1 hour */
const DEFAULT_AT_TTL_SECONDS = 3600;

/**
 * Known clients — hardcoded for Phase 5 option A.
 * Dynamic client registration (RFC 7591) can be added later.
 */
const KNOWN_CLIENTS: Record<string, OAuthClient> = {
  "vscode-casfa-mcp": {
    clientId: "vscode-casfa-mcp",
    clientName: "VS Code CASFA MCP",
    redirectUris: ["http://127.0.0.1:*"],
    grantTypes: ["authorization_code", "refresh_token"],
    tokenEndpointAuthMethod: "none",
  },
};

type OAuthClient = {
  clientId: string;
  clientName: string;
  redirectUris: string[];
  grantTypes: string[];
  tokenEndpointAuthMethod: "none";
};

/** Supported OAuth scopes */
const VALID_SCOPES = new Set(["cas:read", "cas:write", "depot:manage"]);

// ============================================================================
// Controller Factory
// ============================================================================

export const createOAuthAuthController = (
  deps: OAuthAuthControllerDeps,
): OAuthAuthController => {
  const { serverConfig, authCodesDb, delegatesDb } = deps;

  // ──────────────────────────────────────────────────────────────────────────
  // Phase 0: OAuth Authorization Server Metadata (RFC 8414)
  // ──────────────────────────────────────────────────────────────────────────

  const getMetadata = (c: Context<Env>): Response => {
    const issuer = `${serverConfig.baseUrl}/api/auth`;
    return c.json({
      issuer,
      authorization_endpoint: `${serverConfig.baseUrl}/api/auth/authorize`,
      token_endpoint: `${serverConfig.baseUrl}/api/auth/token`,
      registration_endpoint: `${serverConfig.baseUrl}/api/auth/register`,
      token_endpoint_auth_methods_supported: ["none"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      response_types_supported: ["code"],
      code_challenge_methods_supported: ["S256"],
      scopes_supported: ["cas:read", "cas:write", "depot:manage"],
    });
  };

  // ──────────────────────────────────────────────────────────────────────────
  // Phase 1: GET /api/auth/authorize
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Validate OAuth authorize request params and return consent page data.
   *
   * The browser user must be authenticated (JWT in auth context).
   * If they are, we return the consent page info as JSON so the frontend
   * can render a confirmation UI. The frontend then POSTs to approve.
   */
  const authorize = async (c: Context<Env>): Promise<Response> => {
    // Extract and validate all required OAuth params
    const params = {
      responseType: c.req.query("response_type"),
      clientId: c.req.query("client_id"),
      redirectUri: c.req.query("redirect_uri"),
      scope: c.req.query("scope"),
      state: c.req.query("state"),
      codeChallenge: c.req.query("code_challenge"),
      codeChallengeMethod: c.req.query("code_challenge_method"),
    };

    // Validate response_type
    if (params.responseType !== "code") {
      return c.json(
        { error: "unsupported_response_type", error_description: "Only 'code' is supported" },
        400,
      );
    }

    // Validate client_id
    if (!params.clientId) {
      return c.json(
        { error: "invalid_request", error_description: "Missing client_id" },
        400,
      );
    }
    const client = KNOWN_CLIENTS[params.clientId];
    if (!client) {
      return c.json(
        { error: "invalid_client", error_description: "Unknown client_id" },
        400,
      );
    }

    // Validate redirect_uri
    if (!params.redirectUri) {
      return c.json(
        { error: "invalid_request", error_description: "Missing redirect_uri" },
        400,
      );
    }
    if (!isRedirectUriAllowed(params.redirectUri, client.redirectUris)) {
      return c.json(
        { error: "invalid_request", error_description: "redirect_uri not allowed for this client" },
        400,
      );
    }

    // Validate scope
    if (!params.scope) {
      return c.json(
        { error: "invalid_request", error_description: "Missing scope" },
        400,
      );
    }
    const scopes = params.scope.split(" ").filter(Boolean);
    const invalidScopes = scopes.filter((s) => !VALID_SCOPES.has(s));
    if (invalidScopes.length > 0) {
      return c.json(
        {
          error: "invalid_scope",
          error_description: `Unknown scopes: ${invalidScopes.join(", ")}`,
        },
        400,
      );
    }

    // Validate state
    if (!params.state) {
      return c.json(
        { error: "invalid_request", error_description: "Missing state" },
        400,
      );
    }

    // Validate PKCE
    if (!params.codeChallenge || params.codeChallengeMethod !== "S256") {
      return c.json(
        {
          error: "invalid_request",
          error_description: "PKCE required: code_challenge with method S256",
        },
        400,
      );
    }

    // All params valid — return consent page data for the frontend
    return c.json({
      client: {
        clientId: client.clientId,
        clientName: client.clientName,
      },
      scopes,
      state: params.state,
      redirectUri: params.redirectUri,
      codeChallenge: params.codeChallenge,
      codeChallengeMethod: params.codeChallengeMethod,
    });
  };

  // ──────────────────────────────────────────────────────────────────────────
  // Phase 1: POST /api/auth/authorize — User approves authorization
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * User has confirmed the consent. Generate authorization code and redirect.
   *
   * Requires JWT auth — the user must be logged in.
   * Body contains the OAuth params + the user's permission selections.
   */
  const approveAuthorization = async (c: Context<Env>): Promise<Response> => {
    const auth = c.get("auth") as JwtAuthContext;
    if (!auth || auth.type !== "jwt") {
      return c.json({ error: "unauthorized", error_description: "Login required" }, 401);
    }

    const body = await c.req.json();
    const {
      clientId,
      redirectUri,
      scopes,
      state,
      codeChallenge,
      codeChallengeMethod,
      realm,
      grantedPermissions,
    } = body as {
      clientId: string;
      redirectUri: string;
      scopes: string[];
      state: string;
      codeChallenge: string;
      codeChallengeMethod: "S256";
      realm: string;
      grantedPermissions?: Partial<GrantedPermissions>;
    };

    // Validate client
    const client = KNOWN_CLIENTS[clientId];
    if (!client) {
      return c.json({ error: "invalid_client", error_description: "Unknown client_id" }, 400);
    }
    if (!isRedirectUriAllowed(redirectUri, client.redirectUris)) {
      return c.json({ error: "invalid_request", error_description: "Invalid redirect_uri" }, 400);
    }

    // Map scopes → permissions, then narrow by user selections
    const scopePermissions = mapScopesToPermissions(scopes);
    const finalPermissions: GrantedPermissions = {
      canUpload: scopePermissions.canUpload && (grantedPermissions?.canUpload ?? true),
      canManageDepot:
        scopePermissions.canManageDepot && (grantedPermissions?.canManageDepot ?? true),
      delegatedDepots: grantedPermissions?.delegatedDepots,
      scopeNodeHash: grantedPermissions?.scopeNodeHash,
      expiresIn: grantedPermissions?.expiresIn,
    };

    // Generate authorization code (128-bit random, URL-safe base64)
    const codeBytes = randomBytes(16);
    const code = codeBytes.toString("base64url");

    const now = Date.now();
    await authCodesDb.create({
      code,
      clientId,
      redirectUri,
      userId: auth.userId,
      realm: realm || auth.userId, // default realm = userId
      scopes,
      codeChallenge,
      codeChallengeMethod,
      grantedPermissions: finalPermissions,
      createdAt: now,
      expiresAt: now + AUTH_CODE_TTL_MS,
      used: false,
    });

    // Return redirect URL (the frontend will do the actual redirect)
    const redirectUrl = new URL(redirectUri);
    redirectUrl.searchParams.set("code", code);
    redirectUrl.searchParams.set("state", state);

    return c.json({ redirect_uri: redirectUrl.toString() });
  };

  // ──────────────────────────────────────────────────────────────────────────
  // Phase 2: POST /api/auth/token
  // ──────────────────────────────────────────────────────────────────────────

  const token = async (c: Context<Env>): Promise<Response> => {
    // OAuth token endpoint uses application/x-www-form-urlencoded
    const contentType = c.req.header("Content-Type") ?? "";
    let params: Record<string, string>;

    if (contentType.includes("application/x-www-form-urlencoded")) {
      const formData = await c.req.parseBody();
      params = Object.fromEntries(
        Object.entries(formData).map(([k, v]) => [k, String(v)]),
      );
    } else if (contentType.includes("application/json")) {
      // Also support JSON for convenience
      params = await c.req.json();
    } else {
      return c.json(
        { error: "invalid_request", error_description: "Unsupported Content-Type" },
        400,
      );
    }

    const grantType = params.grant_type;

    switch (grantType) {
      case "authorization_code":
        return handleAuthorizationCodeGrant(c, params);
      case "refresh_token":
        return handleRefreshTokenGrant(c, params);
      default:
        return c.json(
          { error: "unsupported_grant_type", error_description: `Unsupported: ${grantType}` },
          400,
        );
    }
  };

  // ──────────────────────────────────────────────────────────────────────────
  // grant_type=authorization_code
  // ──────────────────────────────────────────────────────────────────────────

  const handleAuthorizationCodeGrant = async (
    c: Context<Env>,
    params: Record<string, string>,
  ): Promise<Response> => {
    const { code, redirect_uri, client_id, code_verifier } = params;

    if (!code || !redirect_uri || !client_id || !code_verifier) {
      return c.json(
        {
          error: "invalid_request",
          error_description: "Missing required parameters: code, redirect_uri, client_id, code_verifier",
        },
        400,
      );
    }

    // 1. Atomically consume the authorization code (prevents replay)
    const authCode = await authCodesDb.consume(code);
    if (!authCode) {
      return c.json(
        { error: "invalid_grant", error_description: "Invalid, expired, or already used authorization code" },
        400,
      );
    }

    // 2. Verify redirect_uri and client_id match
    if (authCode.redirectUri !== redirect_uri) {
      return c.json(
        { error: "invalid_grant", error_description: "redirect_uri mismatch" },
        400,
      );
    }
    if (authCode.clientId !== client_id) {
      return c.json(
        { error: "invalid_grant", error_description: "client_id mismatch" },
        400,
      );
    }

    // 3. Verify PKCE: base64url(SHA256(code_verifier)) === code_challenge
    const expectedChallenge = createHash("sha256")
      .update(code_verifier)
      .digest("base64url");
    if (expectedChallenge !== authCode.codeChallenge) {
      return c.json(
        { error: "invalid_grant", error_description: "PKCE verification failed" },
        400,
      );
    }

    // 4. Create child delegate under user's root delegate
    const { delegate: rootDelegate } = await delegatesDb.getOrCreateRoot(
      authCode.realm,
      generateDelegateId(),
    );

    const newDelegateId = generateDelegateId();
    const tokenPair = generateTokenPair({
      delegateId: newDelegateId,
      accessTokenTtlSeconds: DEFAULT_AT_TTL_SECONDS,
    });

    const perms = authCode.grantedPermissions;
    const now = Date.now();
    const expiresAt = perms.expiresIn ? now + perms.expiresIn * 1000 : undefined;

    const newDelegate: Delegate = {
      delegateId: newDelegateId,
      name: `MCP: ${authCode.clientId}`,
      realm: authCode.realm,
      parentId: rootDelegate.delegateId,
      chain: [...rootDelegate.chain, newDelegateId],
      depth: 1,
      canUpload: perms.canUpload,
      canManageDepot: perms.canManageDepot,
      delegatedDepots: perms.delegatedDepots,
      scopeNodeHash: perms.scopeNodeHash,
      expiresAt,
      isRevoked: false,
      createdAt: now,
      currentRtHash: tokenPair.refreshToken.hash,
      currentAtHash: tokenPair.accessToken.hash,
      atExpiresAt: tokenPair.accessToken.expiresAt,
    };

    await delegatesDb.create(newDelegate);

    // 5. Build scope string from granted permissions
    const grantedScopes = ["cas:read"]; // always included
    if (perms.canUpload) grantedScopes.push("cas:write");
    if (perms.canManageDepot) grantedScopes.push("depot:manage");

    // 6. Return standard OAuth token response
    return c.json({
      access_token: tokenPair.accessToken.base64,
      refresh_token: tokenPair.refreshToken.base64,
      token_type: "Bearer",
      expires_in: DEFAULT_AT_TTL_SECONDS,
      scope: grantedScopes.join(" "),
    });
  };

  // ──────────────────────────────────────────────────────────────────────────
  // grant_type=refresh_token
  // ──────────────────────────────────────────────────────────────────────────

  const handleRefreshTokenGrant = async (
    c: Context<Env>,
    params: Record<string, string>,
  ): Promise<Response> => {
    const { refresh_token } = params;

    if (!refresh_token) {
      return c.json(
        { error: "invalid_request", error_description: "Missing refresh_token" },
        400,
      );
    }

    // Decode base64 RT → binary
    let tokenBytes: Uint8Array;
    try {
      tokenBytes = new Uint8Array(Buffer.from(refresh_token, "base64"));
    } catch {
      return c.json(
        { error: "invalid_grant", error_description: "Invalid refresh token format" },
        400,
      );
    }

    // Delegate to shared refresh logic
    try {
      const result = await refreshDelegateToken(tokenBytes, { delegatesDb });
      return c.json({
        access_token: result.newAccessToken,
        refresh_token: result.newRefreshToken,
        token_type: "Bearer",
        expires_in: DEFAULT_AT_TTL_SECONDS,
      });
    } catch (error) {
      if (error instanceof RefreshError) {
        return c.json(
          { error: "invalid_grant", error_description: error.message },
          400,
        );
      }
      throw error;
    }
  };

  return { getMetadata, authorize, approveAuthorization, token };
};

// ============================================================================
// Helpers
// ============================================================================

/**
 * Check if a redirect_uri matches the client's allowed patterns.
 * Supports wildcards for port numbers (e.g., "http://127.0.0.1:*").
 */
function isRedirectUriAllowed(uri: string, allowedPatterns: string[]): boolean {
  for (const pattern of allowedPatterns) {
    if (pattern === uri) return true;
    // Support port wildcards: http://127.0.0.1:* matches http://127.0.0.1:12345/callback
    if (pattern.includes(":*")) {
      const prefix = pattern.split(":*")[0]!;
      if (uri.startsWith(`${prefix}:`)) {
        // Make sure it's the port part that varies
        try {
          const parsed = new URL(uri);
          const patternParsed = new URL(pattern.replace(":*", ":0"));
          if (
            parsed.protocol === patternParsed.protocol &&
            parsed.hostname === patternParsed.hostname
          ) {
            return true;
          }
        } catch {
          // Invalid URL, skip
        }
      }
    }
  }
  return false;
}

/**
 * Map OAuth scope strings to delegate permission flags.
 */
function mapScopesToPermissions(scopes: string[]): {
  canUpload: boolean;
  canManageDepot: boolean;
} {
  return {
    canUpload: scopes.includes("cas:write"),
    canManageDepot: scopes.includes("depot:manage"),
  };
}
