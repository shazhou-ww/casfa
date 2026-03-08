import type { DelegateAuth, DelegateGrant, DelegateGrantStore, DelegatePermission } from "@casfa/cell-delegates-server";
import type { UserAuth } from "@casfa/cell-auth-server";
import type { CognitoConfig, JwtVerifier } from "./types.ts";

export type { DelegateAuth, DelegateGrant, DelegateGrantStore, DelegatePermission } from "@casfa/cell-delegates-server";
export type { UserAuth } from "@casfa/cell-auth-server";

export type Auth = UserAuth | DelegateAuth;

export type OAuthMetadata = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint: string;
  response_types_supported: string[];
  grant_types_supported: string[];
  code_challenge_methods_supported: string[];
  scopes_supported: string[];
};

export type RegisteredClient = {
  clientId: string;
  clientName: string;
  redirectUris: string[];
};

export type CallbackResult =
  | { type: "tokens"; redirectUrl: string }
  | { type: "consent_required"; sessionId: string; redirectUrl: string };

export type ConsentInfo = {
  defaultClientName: string;
  userEmail: string;
  userName: string;
  permissions: DelegatePermission[];
};

export type TokenResponse = {
  access_token: string;
  token_type: string;
  expires_in: number;
  id_token?: string;
  refresh_token?: string;
};

export type OAuthServerConfig = {
  issuerUrl: string;
  cognitoConfig: CognitoConfig;
  jwtVerifier: JwtVerifier;
  grantStore: DelegateGrantStore;
  permissions: DelegatePermission[];
};

export type OAuthServer = {
  /** When issuerUrl is provided, use it for metadata (e.g. request-derived base URL). */
  getMetadata(issuerUrl?: string): OAuthMetadata;
  registerClient(params: { clientName: string; redirectUris: string[] }): RegisteredClient;
  getClientInfo(clientId: string): { clientName: string; redirectUris: string[] } | null;
  handleAuthorize(params: {
    responseType: string;
    clientId: string;
    redirectUri: string;
    state: string;
    scope: string | null;
    codeChallenge: string | null;
    codeChallengeMethod: string | null;
    identityProvider: string | null;
    /** Override issuer base URL for this request (e.g. multi-domain). */
    issuerUrl?: string;
  }): { redirectUrl: string };
  handleCallback(params: { code: string; state: string; /** Override issuer base URL for this request. */ issuerUrl?: string }): Promise<CallbackResult>;
  getConsentInfo(sessionId: string): ConsentInfo | null;
  approveConsent(params: {
    sessionId: string;
    clientName: string;
    /** Override issuer base URL for redirect. */
    issuerUrl?: string;
  }): Promise<{ redirectUrl: string }>;
  denyConsent(sessionId: string): { redirectUrl: string | null };
  handleToken(params: {
    grantType: string;
    code: string | null;
    codeVerifier: string | null;
    refreshToken: string | null;
    clientId: string | null;
  }): Promise<TokenResponse>;
  resolveAuth(bearerToken: string): Promise<Auth | null>;
  listDelegates(userId: string): Promise<DelegateGrant[]>;
  createDelegate(params: {
    userId: string;
    clientName: string;
    permissions: DelegatePermission[];
  }): Promise<{ grant: DelegateGrant; accessToken: string; refreshToken: string }>;
  revokeDelegate(delegateId: string): Promise<void>;
};
