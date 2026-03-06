import type { DelegateGrant, DelegateGrantStore } from "./types.ts";

export function createMemoryDelegateGrantStore(): DelegateGrantStore {
  const byId = new Map<string, DelegateGrant>();
  const byUserAndHash = new Map<string, DelegateGrant>();
  const byUserAndRefreshHash = new Map<string, DelegateGrant>();

  function userHashKey(userId: string, hash: string): string {
    return `${userId}:${hash}`;
  }

  return {
    async list(userId: string) {
      return Array.from(byId.values()).filter((g) => g.userId === userId);
    },
    async get(delegateId: string) {
      return byId.get(delegateId) ?? null;
    },
    async getByAccessTokenHash(userId: string, hash: string) {
      return byUserAndHash.get(userHashKey(userId, hash)) ?? null;
    },
    async getByRefreshTokenHash(userId: string, hash: string) {
      return byUserAndRefreshHash.get(userHashKey(userId, hash)) ?? null;
    },
    async insert(grant: DelegateGrant) {
      byId.set(grant.delegateId, grant);
      byUserAndHash.set(userHashKey(grant.userId, grant.accessTokenHash), grant);
      if (grant.refreshTokenHash) {
        byUserAndRefreshHash.set(userHashKey(grant.userId, grant.refreshTokenHash), grant);
      }
    },
    async remove(delegateId: string) {
      const g = byId.get(delegateId);
      if (g) {
        byId.delete(delegateId);
        byUserAndHash.delete(userHashKey(g.userId, g.accessTokenHash));
        if (g.refreshTokenHash) {
          byUserAndRefreshHash.delete(userHashKey(g.userId, g.refreshTokenHash));
        }
      }
    },
    async updateTokens(
      delegateId: string,
      update: { accessTokenHash: string; refreshTokenHash: string | null }
    ) {
      const g = byId.get(delegateId);
      if (!g) return;
      byUserAndHash.delete(userHashKey(g.userId, g.accessTokenHash));
      if (g.refreshTokenHash) {
        byUserAndRefreshHash.delete(userHashKey(g.userId, g.refreshTokenHash));
      }
      const updated: DelegateGrant = {
        ...g,
        accessTokenHash: update.accessTokenHash,
        refreshTokenHash: update.refreshTokenHash,
      };
      byId.set(delegateId, updated);
      byUserAndHash.set(userHashKey(updated.userId, updated.accessTokenHash), updated);
      if (updated.refreshTokenHash) {
        byUserAndRefreshHash.set(userHashKey(updated.userId, updated.refreshTokenHash), updated);
      }
    },
  };
}
