export type DelegatePermission = "use_mcp" | "manage_delegates" | (string & {});

export type UserAuth = {
  type: "user";
  userId: string;
};

export type DelegateAuth = {
  type: "delegate";
  userId: string;
  delegateId: string;
  permissions: DelegatePermission[];
};

export type Auth = UserAuth | DelegateAuth;

export type DelegateGrant = {
  delegateId: string;
  userId: string;
  clientName: string;
  permissions: DelegatePermission[];
  accessTokenHash: string;
  refreshTokenHash: string | null;
  createdAt: number;
  expiresAt: number;
};

export type DelegateGrantStore = {
  list(userId: string): Promise<DelegateGrant[]>;
  get(delegateId: string): Promise<DelegateGrant | null>;
  getByAccessTokenHash(userId: string, hash: string): Promise<DelegateGrant | null>;
  getByRefreshTokenHash(userId: string, hash: string): Promise<DelegateGrant | null>;
  insert(grant: DelegateGrant): Promise<void>;
  remove(delegateId: string): Promise<void>;
  updateTokens(
    delegateId: string,
    update: { accessTokenHash: string; refreshTokenHash: string | null }
  ): Promise<void>;
};

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
