/**
 * In-memory DelegateStore for tests and local use.
 */
import type { Delegate, DelegateStore } from "./types.ts";

export function createMemoryDelegateStore(): DelegateStore {
  const delegates = new Map<string, Delegate>();
  const roots = new Map<string, string>();

  return {
    async getDelegate(delegateId: string) {
      return delegates.get(delegateId) ?? null;
    },
    async getRoot(delegateId: string) {
      return roots.get(delegateId) ?? null;
    },
    async setRoot(delegateId: string, nodeKey: string) {
      roots.set(delegateId, nodeKey);
    },
    async listDelegates(realmId: string) {
      return Array.from(delegates.values()).filter((d) => d.realmId === realmId);
    },
    async insertDelegate(delegate: Delegate) {
      delegates.set(delegate.delegateId, delegate);
    },
    async removeDelegate(delegateId: string) {
      delegates.delete(delegateId);
      roots.delete(delegateId);
    },
    async updateDelegatePath(delegateId: string, newPath: string) {
      const d = delegates.get(delegateId);
      if (d) delegates.set(delegateId, { ...d, mountPath: newPath });
    },
    async setClosed(delegateId: string) {
      delegates.delete(delegateId);
      roots.delete(delegateId);
    },
    async purgeExpiredDelegates(expiredBefore: number) {
      let count = 0;
      for (const [id, d] of delegates) {
        const exp = d.lifetime === "limited" ? d.expiresAt : d.accessExpiresAt;
        if (exp < expiredBefore) {
          delegates.delete(id);
          roots.delete(id);
          count++;
        }
      }
      return count;
    },
  };
}
