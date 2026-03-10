/**
 * OAuth Auth Controller
 *
 * Handles MCP OAuth 2.1 Authorization Code + PKCE flow.
 * Uses /api/auth/* routes (not /api/oauth/* which is Cognito proxy).
 *
 * Endpoints:
 * - GET /.well-known/oauth-authorization-server — RFC 8414 metadata
 * - GET /.well-known/oauth-protected-resource[/*] — RFC 9728 PRM
 * - GET /api/auth/authorize/info — Validate params, return client info (JSON API)
 * - POST /api/auth/authorize — User approves authorization (requires JWT)
 * - POST /api/auth/token — Token endpoint (code exchange + refresh)
 * - POST /api/auth/register — Dynamic client registration (RFC 7591)
 *
 * The authorization_endpoint in metadata points to /oauth/authorize (frontend),
 * not to the API. The frontend page calls GET /api/auth/authorize to validate
 * params, then POSTs to approve.
 *
 * Delegates OAuth protocol logic to `@casfa/oauth-provider`:
 * - Metadata generation → `generateAuthServerMetadata` / `generateProtectedResourceMetadata`
 * - Authorization request validation → `validateAuthorizationRequest`
 * - Scope mapping → `mapScopes`
 * - Client registration → `registerClient`
 * - Redirect URI matching → `isRedirectUriAllowed`
 */

import { randomBytes } from "node:crypto";
import { verifyPkceChallenge } from "@casfa/client-auth-crypto";
import type { Delegate } from "@casfa/delegate";
import {
  type AuthServerConfig,
  type ClientStore,
  generateAuthServerMetadata,
  generateProtectedResourceMetadata,
  isRedirectUriAllowed,
  mapScopes,
  type OAuthClient,
  registerClient,
  resolveClient as resolveClientFromStore,
  type ScopeDefinition,
  validateAuthorizationRequest,
} from "@casfa/oauth-provider";
import type { Context } from "hono";
import type { ServerConfig } from "../config.ts";
import type { AuthCodesDb, GrantedPermissions } from "../db/auth-codes.ts";
import type { DelegatesDb } from "../db/delegates.ts";
import type { OAuthClientsDb } from "../db/oauth-clients.ts";
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
  oauthClientsDb: OAuthClientsDb;
};

export type OAuthAuthController = {
  /** GET /.well-known/oauth-authorization-server */
  getMetadata: (c: Context<Env>) => Response;
  /** GET /.well-known/oauth-protected-resource — RFC 9728 */
  getProtectedResourceMetadata: (c: Context<Env>) => Response;
  /** GET /api/auth/authorize/info — validate params, return client info as JSON */
  authorizeInfo: (c: Context<Env>) => Promise<Response>;
  /** POST /api/auth/authorize — user approves, generates code and redirects */
  approveAuthorization: (c: Context<Env>) => Promise<Response>;
  /** POST /api/auth/token — exchange code or refresh token */
  token: (c: Context<Env>) => Promise<Response>;
  /** POST /api/auth/register — dynamic client registration (RFC 7591) */
  register: (c: Context<Env>) => Promise<Response>;
};

// ============================================================================
// Constants
// ============================================================================

/** Default access token TTL: 1 hour */
const DEFAULT_AT_TTL_SECONDS = 3600;

/** Authorization code TTL: 10 minutes */
const AUTH_CODE_TTL_MS = 10 * 60 * 1000;

/**
 * Hardcoded well-known clients.
 * Dynamic clients are persisted in DynamoDB via oauthClientsDb.
 */
const HARDCODED_CLIENTS = new Map<string, OAuthClient>([
  [
    "vscode-casfa-mcp",
    {
      clientId: "vscode-casfa-mcp",
      clientName: "VS Code CASFA MCP",
      redirectUris: ["http://127.0.0.1:*"],
      grantTypes: ["authorization_code", "refresh_token"],
      tokenEndpointAuthMethod: "none",
      createdAt: 0,
    },
  ],
]);

/** Supported OAuth scopes */
const SCOPE_DEFINITIONS: ScopeDefinition[] = [
  { name: "cas:read", description: "Read content from your CAS storage" },
  { name: "cas:write", description: "Upload and write content to your CAS storage" },
  { name: "depot:manage", description: "Create and manage depots" },
];

const SUPPORTED_SCOPE_NAMES = SCOPE_DEFINITIONS.map((s) => s.name);

// ============================================================================
// Controller Factory
// ============================================================================

export const createOAuthAuthController = (deps: OAuthAuthControllerDeps): OAuthAuthController => {
  const { serverConfig, authCodesDb, delegatesDb, oauthClientsDb } = deps;

  // ── ClientStore adapter for @casfa/oauth-provider ──
  const clientStore: ClientStore = {
    get: async (clientId: string): Promise<OAuthClient | null> => {
      const record = await oauthClientsDb.get(clientId);
      if (!record) {
        // Auto-accept previously-registered dyn_ clients not yet in DB
        if (clientId.startsWith("dyn_")) {
          const newClient: OAuthClient = {
            clientId,
            clientName: "MCP Client",
            redirectUris: ["http://127.0.0.1:*", "http://localhost:*"],
            grantTypes: ["authorization_code", "refresh_token"],
            tokenEndpointAuthMethod: "none",
            createdAt: Date.now(),
          };
          await oauthClientsDb.put({ ...newClient, tokenEndpointAuthMethod: "none" });
          return newClient;
        }
        return null;
      }
      return {
        clientId: record.clientId,
        clientName: record.clientName,
        redirectUris: record.redirectUris,
        grantTypes: record.grantTypes,
        tokenEndpointAuthMethod: record.tokenEndpointAuthMethod,
        createdAt: record.createdAt,
      };
    },
    save: async (client: OAuthClient): Promise<void> => {
      await oauthClientsDb.put({ ...client, tokenEndpointAuthMethod: "none" });
    },
  };

  /** Resolve a client by ID: hardcoded first, then store. */
  const resolveClient = (clientId: string) =>
    resolveClientFromStore(clientId, clientStore, HARDCODED_CLIENTS);

  // ──────────────────────────────────────────────────────────────────────────
  // Phase 0: OAuth Authorization Server Metadata (RFC 8414)
  // ──────────────────────────────────────────────────────────────────────────

  const getMetadata = (c: Context<Env>): Response => {
    const host = c.req.header("X-Forwarded-Host") ?? c.req.header("Host");
    const proto = c.req.header("X-Forwarded-Proto") ?? "http";
    const baseUrl = host ? `${proto}://${host}` : serverConfig.baseUrl;

    const config: AuthServerConfig = {
      issuer: `${baseUrl}/api/auth`,
      authorizationEndpoint: `${baseUrl}/oauth/authorize`,
      tokenEndpoint: `${baseUrl}/api/auth/token`,
      registrationEndpoint: `${baseUrl}/api/auth/register`,
      supportedGrantTypes: ["authorization_code", "refresh_token"],
      supportedResponseTypes: ["code"],
      codeChallengeMethodsSupported: ["S256"],
      supportedScopes: SCOPE_DEFINITIONS,
    };

    return c.json(generateAuthServerMetadata(config));
  };

  // ──────────────────────────────────────────────────────────────────────────
  // Phase 0b: OAuth Protected Resource Metadata (RFC 9728)
  // ──────────────────────────────────────────────────────────────────────────

  const getProtectedResourceMetadata = (c: Context<Env>): Response => {
    const host = c.req.header("X-Forwarded-Host") ?? c.req.header("Host");
    const proto = c.req.header("X-Forwarded-Proto") ?? "http";
    const baseUrl = host ? `${proto}://${host}` : serverConfig.baseUrl;

    return c.json(
      generateProtectedResourceMetadata({
        resource: `${baseUrl}/api/mcp`,
        authorizationServers: [baseUrl],
        scopesSupported: SUPPORTED_SCOPE_NAMES,
      })
    );
  };

  // ──────────────────────────────────────────────────────────────────────────
  // GET /api/auth/authorize/info — validate params, return client info JSON
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Validate all OAuth authorize params and return client info + scope
   * descriptions as JSON. Called by the frontend /oauth/authorize page.
   *
   * No auth required — this is a public validation endpoint.
   */
  const authorizeInfo = async (c: Context<Env>): Promise<Response> => {
    const result = await validateAuthorizationRequest(
      {
        responseType: c.req.query("response_type"),
        clientId: c.req.query("client_id"),
        redirectUri: c.req.query("redirect_uri"),
        scope: c.req.query("scope"),
        state: c.req.query("state"),
        codeChallenge: c.req.query("code_challenge"),
        codeChallengeMethod: c.req.query("code_challenge_method"),
      },
      {
        resolveClient,
        supportedScopes: SUPPORTED_SCOPE_NAMES,
      }
    );

    if (!result.ok) {
      return c.json(
        { error: result.error.code, error_description: result.error.message },
        result.error.statusCode as 400
      );
    }

    const { client, scopes, state, redirectUri, codeChallenge } = result.value;

    // All params valid — return client info + scope descriptions
    return c.json({
      client: {
        clientId: client.clientId,
        clientName: client.clientName,
      },
      scopes: scopes.map((s) => ({
        name: s,
        description: SCOPE_DEFINITIONS.find((d) => d.name === s)?.description ?? s,
      })),
      state,
      redirectUri,
      codeChallenge,
      codeChallengeMethod: "S256",
    });
  };

  // ──────────────────────────────────────────────────────────────────────────
  // POST /api/auth/authorize — User approves authorization
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
    const client = await resolveClient(clientId);
    if (!client) {
      return c.json({ error: "invalid_client", error_description: "Unknown client_id" }, 400);
    }
    if (!isRedirectUriAllowed(redirectUri, client.redirectUris)) {
      return c.json({ error: "invalid_request", error_description: "Invalid redirect_uri" }, 400);
    }

    // Map scopes → permissions via @casfa/oauth-provider, then narrow by user selections
    type Perms = { canUpload: boolean; canManageDepot: boolean };
    const scopePermissions = mapScopes<Perms>(
      scopes,
      {
        "cas:write": { canUpload: true },
        "depot:manage": { canManageDepot: true },
      },
      { canUpload: false, canManageDepot: false }
    );
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
  // POST /api/auth/token
  // ──────────────────────────────────────────────────────────────────────────

  const token = async (c: Context<Env>): Promise<Response> => {
    const contentType = c.req.header("Content-Type") ?? "";
    let params: Record<string, string>;

    if (contentType.includes("application/x-www-form-urlencoded")) {
      const formData = await c.req.parseBody();
      params = Object.fromEntries(Object.entries(formData).map(([k, v]) => [k, String(v)]));
    } else if (contentType.includes("application/json")) {
      params = await c.req.json();
    } else {
      return c.json(
        { error: "invalid_request", error_description: "Unsupported Content-Type" },
        400
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
          400
        );
    }
  };

  // ──────────────────────────────────────────────────────────────────────────
  // grant_type=authorization_code
  // ──────────────────────────────────────────────────────────────────────────

  const handleAuthorizationCodeGrant = async (
    c: Context<Env>,
    params: Record<string, string>
  ): Promise<Response> => {
    const { code, redirect_uri, client_id, code_verifier } = params;

    if (!code || !redirect_uri || !client_id || !code_verifier) {
      return c.json(
        {
          error: "invalid_request",
          error_description:
            "Missing required parameters: code, redirect_uri, client_id, code_verifier",
        },
        400
      );
    }

    // 1. Atomically consume the authorization code (prevents replay)
    const authCode = await authCodesDb.consume(code);
    if (!authCode) {
      return c.json(
        {
          error: "invalid_grant",
          error_description: "Invalid, expired, or already used authorization code",
        },
        400
      );
    }

    // 2. Verify redirect_uri and client_id match
    if (authCode.redirectUri !== redirect_uri) {
      return c.json({ error: "invalid_grant", error_description: "redirect_uri mismatch" }, 400);
    }
    if (authCode.clientId !== client_id) {
      return c.json({ error: "invalid_grant", error_description: "client_id mismatch" }, 400);
    }

    // 3. Verify PKCE via @casfa/client-auth-crypto
    const pkceValid = await verifyPkceChallenge(code_verifier, authCode.codeChallenge);
    if (!pkceValid) {
      return c.json({ error: "invalid_grant", error_description: "PKCE verification failed" }, 400);
    }

    // 4. Create child delegate under user's root delegate
    const { delegate: rootDelegate } = await delegatesDb.getOrCreateRoot(
      authCode.realm,
      generateDelegateId()
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
    params: Record<string, string>
  ): Promise<Response> => {
    const { refresh_token } = params;

    if (!refresh_token) {
      return c.json({ error: "invalid_request", error_description: "Missing refresh_token" }, 400);
    }

    let tokenBytes: Uint8Array;
    try {
      tokenBytes = new Uint8Array(Buffer.from(refresh_token, "base64"));
    } catch {
      return c.json(
        { error: "invalid_grant", error_description: "Invalid refresh token format" },
        400
      );
    }

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
        return c.json({ error: "invalid_grant", error_description: error.message }, 400);
      }
      throw error;
    }
  };

  // ──────────────────────────────────────────────────────────────────────────
  // POST /api/auth/register — Dynamic Client Registration (RFC 7591)
  // ──────────────────────────────────────────────────────────────────────────

  const register = async (c: Context<Env>): Promise<Response> => {
    const body = await c.req.json();
    const { client_name, redirect_uris, grant_types } = body as {
      client_name?: string;
      redirect_uris?: string[];
      grant_types?: string[];
    };

    const result = await registerClient(
      {
        clientName: client_name ?? "MCP Client",
        redirectUris: redirect_uris ?? [],
        grantTypes: grant_types,
      },
      clientStore,
      {
        generateClientId: () => `dyn_${randomBytes(16).toString("base64url")}`,
      }
    );

    if (!result.ok) {
      return c.json(
        { error: result.error.code, error_description: result.error.message },
        result.error.statusCode as 400
      );
    }

    const client = result.value;
    return c.json(
      {
        client_id: client.clientId,
        client_name: client.clientName,
        redirect_uris: client.redirectUris,
        grant_types: client.grantTypes,
        token_endpoint_auth_method: client.tokenEndpointAuthMethod,
        client_id_issued_at: Math.floor(client.createdAt / 1000),
      },
      201
    );
  };

  return {
    getMetadata,
    getProtectedResourceMetadata,
    authorizeInfo,
    approveAuthorization,
    token,
    register,
  };
};
