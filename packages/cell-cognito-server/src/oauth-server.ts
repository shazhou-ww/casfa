import type { CognitoConfig, JwtVerifier } from "./types.ts";
import { exchangeCodeForTokens, refreshCognitoTokens } from "./cognito-client.ts";
import {
  createDelegateAccessToken,
  decodeDelegateTokenPayload,
  generateDelegateId,
  generateRandomToken,
  sha256Hex,
  verifyCodeChallenge,
} from "@casfa/cell-delegates-server";
import type {
  Auth,
  CallbackResult,
  ConsentInfo,
  DelegateGrant,
  DelegateGrantStore,
  DelegatePermission,
  OAuthMetadata,
  OAuthServerConfig,
  OAuthServer,
  RegisteredClient,
  TokenResponse,
} from "./oauth-server-types.ts";

const DEFAULT_ACCESS_TTL_MS = 24 * 60 * 60 * 1000;
const AUTH_CODE_TTL_MS = 5 * 60 * 1000;
const CONSENT_TTL_MS = 10 * 60 * 1000;
const REGISTRATION_TTL_MS = 60 * 60 * 1000;

type PendingAuthCode = {
  accessToken: string;
  refreshToken: string;
  idToken: string | null;
  expiresIn: number;
  isDelegateFlow: boolean;
  createdAt: number;
  codeChallenge: string | null;
  codeChallengeMethod: string | null;
};

type PendingConsent = {
  userId: string;
  userEmail: string;
  userName: string;
  clientRedirectUri: string;
  clientState: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  defaultClientName: string;
  createdAt: number;
};

type InternalRegisteredClient = {
  clientName: string;
  redirectUris: string[];
  createdAt: number;
};

export function createOAuthServer(config: OAuthServerConfig): OAuthServer {
  const { issuerUrl, cognitoConfig, jwtVerifier, grantStore } = config;

  const pendingCodes = new Map<string, PendingAuthCode>();
  const pendingConsents = new Map<string, PendingConsent>();
  const registeredClients = new Map<string, InternalRegisteredClient>();

  function cleanExpired() {
    const now = Date.now();
    for (const [k, v] of pendingCodes) {
      if (now - v.createdAt > AUTH_CODE_TTL_MS) pendingCodes.delete(k);
    }
    for (const [k, v] of pendingConsents) {
      if (now - v.createdAt > CONSENT_TTL_MS) pendingConsents.delete(k);
    }
    for (const [k, v] of registeredClients) {
      if (now - v.createdAt > REGISTRATION_TTL_MS) registeredClients.delete(k);
    }
  }

  return {
    getMetadata(overrideIssuer?: string): OAuthMetadata {
      const base = overrideIssuer ?? issuerUrl;
      return {
        issuer: base,
        authorization_endpoint: `${base}/oauth/authorize`,
        token_endpoint: `${base}/oauth/token`,
        registration_endpoint: `${base}/oauth/register`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        code_challenge_methods_supported: ["S256"],
        scopes_supported: ["openid", "profile", "email", "delegate"],
      };
    },

    registerClient(params) {
      cleanExpired();
      const virtualId = `${cognitoConfig.clientId}:${generateRandomToken().substring(0, 16)}`;
      registeredClients.set(virtualId, {
        clientName: params.clientName,
        redirectUris: params.redirectUris,
        createdAt: Date.now(),
      });
      return {
        clientId: virtualId,
        clientName: params.clientName,
        redirectUris: params.redirectUris,
      };
    },

    getClientInfo(clientId: string) {
      const registered = registeredClients.get(clientId);
      if (!registered) return null;
      return { clientName: registered.clientName, redirectUris: registered.redirectUris };
    },

    handleAuthorize(params) {
      const base = params.issuerUrl ?? issuerUrl;
      const registered = registeredClients.get(params.clientId);
      const clientName = registered?.clientName ?? "MCP Client";
      const scope = params.scope ?? "openid profile email";
      const serverCallbackUri = `${base}/oauth/callback`;

      const wrappedState = btoa(
        JSON.stringify({
          s: params.state,
          r: params.redirectUri,
          sc: scope,
          cc: params.codeChallenge ?? "",
          ccm: params.codeChallengeMethod ?? "",
          cn: clientName,
        })
      );

      const query = new URLSearchParams({
        client_id: cognitoConfig.clientId,
        response_type: "code",
        scope: "openid profile email",
        redirect_uri: serverCallbackUri,
        state: wrappedState,
      });
      if (params.identityProvider) query.set("identity_provider", params.identityProvider);

      return {
        redirectUrl: `${cognitoConfig.hostedUiUrl}/oauth2/authorize?${query}`,
      };
    },

    async handleCallback(params) {
      const base = params.issuerUrl ?? issuerUrl;
      let clientState = "";
      let clientRedirectUri = "";
      let scope = "openid profile email";
      let codeChallenge = "";
      let codeChallengeMethod = "";
      let clientName = "MCP Client";

      try {
        const parsed = JSON.parse(atob(params.state));
        clientState = parsed.s ?? "";
        clientRedirectUri = parsed.r ?? "";
        scope = parsed.sc ?? scope;
        codeChallenge = parsed.cc ?? "";
        codeChallengeMethod = parsed.ccm ?? "";
        clientName = parsed.cn ?? clientName;
      } catch {
        /* state not wrapped, treat as frontend flow */
      }

      const serverCallbackUri = `${base}/oauth/callback`;
      const cognitoTokens = await exchangeCodeForTokens(
        cognitoConfig,
        params.code,
        serverCallbackUri
      );

      const idTokenParts = cognitoTokens.idToken.split(".");
      const idTokenPayload = JSON.parse(atob(idTokenParts[1]!));
      const userId = idTokenPayload.sub as string;

      cleanExpired();

      if (scope.includes("delegate")) {
        const sessionToken = generateRandomToken();
        pendingConsents.set(sessionToken, {
          userId,
          userEmail: idTokenPayload.email ?? "",
          userName: idTokenPayload.name ?? "",
          clientRedirectUri,
          clientState,
          codeChallenge,
          codeChallengeMethod,
          defaultClientName: clientName,
          createdAt: Date.now(),
        });

        const consentUrl = new URL(`${base}/oauth/consent`);
        consentUrl.searchParams.set("session", sessionToken);
        return {
          type: "consent_required" as const,
          sessionId: sessionToken,
          redirectUrl: consentUrl.toString(),
        };
      }

      const ourCode = generateRandomToken();
      pendingCodes.set(ourCode, {
        accessToken: cognitoTokens.accessToken,
        refreshToken: cognitoTokens.refreshToken,
        idToken: cognitoTokens.idToken,
        expiresIn: cognitoTokens.expiresAt - Math.floor(Date.now() / 1000),
        isDelegateFlow: false,
        createdAt: Date.now(),
        codeChallenge: codeChallenge || null,
        codeChallengeMethod: codeChallengeMethod || null,
      });

      const redirectUrl = new URL(`${base}/oauth/callback-complete`);
      redirectUrl.searchParams.set("code", ourCode);
      return { type: "tokens" as const, redirectUrl: redirectUrl.toString() };
    },

    getConsentInfo(sessionId) {
      cleanExpired();
      const pending = pendingConsents.get(sessionId);
      if (!pending) return null;
      return {
        defaultClientName: pending.defaultClientName,
        userEmail: pending.userEmail,
        userName: pending.userName,
        permissions: ["use_mcp"] as DelegatePermission[],
      };
    },

    async approveConsent(params) {
      cleanExpired();
      const pending = pendingConsents.get(params.sessionId);
      if (!pending) throw new Error("expired_or_invalid_session");
      pendingConsents.delete(params.sessionId);

      const clientName = params.clientName.trim() || pending.defaultClientName;
      const delegateId = generateDelegateId();
      const accessToken = createDelegateAccessToken(pending.userId, delegateId);
      const refreshToken = generateRandomToken();
      const now = Date.now();

      await grantStore.insert({
        delegateId,
        userId: pending.userId,
        clientName,
        permissions: ["use_mcp"],
        accessTokenHash: await sha256Hex(accessToken),
        refreshTokenHash: await sha256Hex(refreshToken),
        createdAt: now,
        expiresAt: now + DEFAULT_ACCESS_TTL_MS,
      });

      const ourCode = generateRandomToken();
      pendingCodes.set(ourCode, {
        accessToken,
        refreshToken,
        idToken: null,
        expiresIn: DEFAULT_ACCESS_TTL_MS / 1000,
        isDelegateFlow: true,
        createdAt: now,
        codeChallenge: pending.codeChallenge || null,
        codeChallengeMethod: pending.codeChallengeMethod || null,
      });

      if (pending.clientRedirectUri) {
        const redirectUrl = new URL(pending.clientRedirectUri);
        redirectUrl.searchParams.set("code", ourCode);
        if (pending.clientState) redirectUrl.searchParams.set("state", pending.clientState);
        return { redirectUrl: redirectUrl.toString() };
      }

      return { redirectUrl: `${params.issuerUrl ?? issuerUrl}/oauth/callback-complete?code=${ourCode}` };
    },

    denyConsent(sessionId) {
      cleanExpired();
      const pending = pendingConsents.get(sessionId);
      pendingConsents.delete(sessionId);
      if (pending?.clientRedirectUri) {
        const url = new URL(pending.clientRedirectUri);
        url.searchParams.set("error", "access_denied");
        if (pending.clientState) url.searchParams.set("state", pending.clientState);
        return { redirectUrl: url.toString() };
      }
      return { redirectUrl: null };
    },

    async handleToken(params) {
      if (params.grantType === "authorization_code") {
        if (!params.code) throw new Error("missing code");
        cleanExpired();
        const pending = pendingCodes.get(params.code);
        if (!pending) throw new Error("invalid_grant: unknown or expired code");
        pendingCodes.delete(params.code);

        if (pending.codeChallenge && pending.codeChallengeMethod) {
          if (!params.codeVerifier) throw new Error("invalid_request: code_verifier required");
          const valid = await verifyCodeChallenge(
            params.codeVerifier,
            pending.codeChallenge,
            pending.codeChallengeMethod
          );
          if (!valid) throw new Error("invalid_grant: code_verifier mismatch");
        }

        const response: TokenResponse = {
          access_token: pending.accessToken,
          token_type: "Bearer",
          expires_in: pending.expiresIn,
        };
        if (!pending.isDelegateFlow && pending.idToken) {
          response.id_token = pending.idToken;
        }
        if (pending.refreshToken) {
          response.refresh_token = pending.refreshToken;
        }
        return response;
      }

      if (params.grantType === "refresh_token") {
        if (!params.refreshToken) throw new Error("missing refresh_token");
        const cognitoTokens = await refreshCognitoTokens(cognitoConfig, params.refreshToken);
        return {
          access_token: cognitoTokens.accessToken,
          token_type: "Bearer",
          expires_in: cognitoTokens.expiresAt - Math.floor(Date.now() / 1000),
          id_token: cognitoTokens.idToken,
        };
      }

      throw new Error("unsupported_grant_type");
    },

    async resolveAuth(bearerToken) {
      const parts = bearerToken.split(".");
      const hash = await sha256Hex(bearerToken);

      if (parts.length >= 3) {
        try {
          const verified = await jwtVerifier(bearerToken);
          let grant: DelegateGrant | null = null;
          try {
            grant = await grantStore.getByAccessTokenHash(verified.userId, hash);
          } catch {
            // Grant-store lookup is optional for user tokens; do not reject valid JWTs.
            grant = null;
          }
          if (grant) {
            return {
              type: "delegate",
              userId: verified.userId,
              delegateId: grant.delegateId,
              permissions: grant.permissions,
            };
          }
          const picture = typeof verified.rawClaims?.picture === "string" ? verified.rawClaims.picture : undefined;
          return {
            type: "user",
            userId: verified.userId,
            email: verified.email,
            name: verified.name,
            picture,
          };
        } catch {
          return null;
        }
      }

      if (parts.length === 2) {
        const payload = decodeDelegateTokenPayload(bearerToken);
        if (!payload) return null;
        const grant = await grantStore.getByAccessTokenHash(payload.sub, hash);
        if (grant) {
          return {
            type: "delegate",
            userId: payload.sub,
            delegateId: grant.delegateId,
            permissions: grant.permissions,
          };
        }
        return null;
      }

      return null;
    },

    async listDelegates(userId) {
      return grantStore.list(userId);
    },

    async createDelegate(params) {
      const delegateId = generateDelegateId();
      const accessToken = createDelegateAccessToken(params.userId, delegateId);
      const refreshToken = generateRandomToken();
      const now = Date.now();

      const grant: DelegateGrant = {
        delegateId,
        userId: params.userId,
        clientName: params.clientName,
        permissions: params.permissions,
        accessTokenHash: await sha256Hex(accessToken),
        refreshTokenHash: await sha256Hex(refreshToken),
        createdAt: now,
        expiresAt: now + DEFAULT_ACCESS_TTL_MS,
      };

      await grantStore.insert(grant);
      return { grant, accessToken, refreshToken };
    },

    async revokeDelegate(delegateId) {
      await grantStore.remove(delegateId);
    },
  };
}
