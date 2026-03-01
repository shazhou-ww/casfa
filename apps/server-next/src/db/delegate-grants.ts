import type { DelegatePermission } from "../types.ts";

export type DelegateGrant = {
  delegateId: string;
  realmId: string;
  clientId: string;
  accessTokenHash: string;
  refreshTokenHash: string | null;
  permissions: DelegatePermission[];
  createdAt: number;
  expiresAt: number | null;
};

export type DelegateGrantStore = {
  list(realmId: string): Promise<DelegateGrant[]>;
  get(delegateId: string): Promise<DelegateGrant | null>;
  getByAccessTokenHash(realmId: string, hash: string): Promise<DelegateGrant | null>;
  insert(grant: DelegateGrant): Promise<void>;
  remove(delegateId: string): Promise<void>;
  updateTokens(
    delegateId: string,
    update: { accessTokenHash: string; refreshTokenHash?: string }
  ): Promise<void>;
};

export function createMemoryDelegateGrantStore(): DelegateGrantStore {
  const byId = new Map<string, DelegateGrant>();
  const byRealmAndHash = new Map<string, DelegateGrant>();

  function realmHashKey(realmId: string, hash: string): string {
    return `${realmId}:${hash}`;
  }

  return {
    async list(realmId: string) {
      return Array.from(byId.values()).filter((g) => g.realmId === realmId);
    },
    async get(delegateId: string) {
      return byId.get(delegateId) ?? null;
    },
    async getByAccessTokenHash(realmId: string, hash: string) {
      return byRealmAndHash.get(realmHashKey(realmId, hash)) ?? null;
    },
    async insert(grant: DelegateGrant) {
      byId.set(grant.delegateId, grant);
      byRealmAndHash.set(realmHashKey(grant.realmId, grant.accessTokenHash), grant);
    },
    async remove(delegateId: string) {
      const g = byId.get(delegateId);
      if (g) {
        byId.delete(delegateId);
        byRealmAndHash.delete(realmHashKey(g.realmId, g.accessTokenHash));
      }
    },
    async updateTokens(delegateId: string, update) {
      const g = byId.get(delegateId);
      if (!g) return;
      byRealmAndHash.delete(realmHashKey(g.realmId, g.accessTokenHash));
      const updated: DelegateGrant = {
        ...g,
        accessTokenHash: update.accessTokenHash,
        refreshTokenHash: update.refreshTokenHash ?? g.refreshTokenHash,
      };
      byId.set(delegateId, updated);
      byRealmAndHash.set(realmHashKey(updated.realmId, updated.accessTokenHash), updated);
    },
  };
}
