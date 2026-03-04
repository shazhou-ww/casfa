export type DelegatePermission = "use_mcp" | "manage_delegates";

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
  expiresAt: number | null;
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
    update: { accessTokenHash: string; refreshTokenHash?: string }
  ): Promise<void>;
};
