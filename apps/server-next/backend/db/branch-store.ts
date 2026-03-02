/**
 * BranchStore: realm root + task branches.
 * Memory impl for tests.
 */
import type { Branch } from "../types/branch.ts";

export type BranchStore = {
  getBranch(branchId: string): Promise<Branch | null>;
  getRealmRoot(realmId: string): Promise<string | null>;
  getRealmRootRecord(realmId: string): Promise<{ branchId: string } | null>;
  setRealmRoot(realmId: string, nodeKey: string): Promise<void>;
  ensureRealmRoot(realmId: string, emptyRootKey: string): Promise<void>;
  getBranchRoot(branchId: string): Promise<string | null>;
  setBranchRoot(branchId: string, nodeKey: string): Promise<void>;
  listBranches(realmId: string): Promise<Branch[]>;
  insertBranch(branch: Branch): Promise<void>;
  removeBranch(branchId: string): Promise<void>;
  purgeExpiredBranches(expiredBefore: number): Promise<number>;
};

export function createMemoryBranchStore(): BranchStore {
  const branches = new Map<string, Branch>();
  const roots = new Map<string, string>();
  const realmRootBranchId = new Map<string, string>();

  return {
    async getBranch(branchId: string) {
      return branches.get(branchId) ?? null;
    },

    async getRealmRoot(realmId: string) {
      const branchId = realmRootBranchId.get(realmId);
      if (!branchId) return null;
      return roots.get(branchId) ?? null;
    },

    async getRealmRootRecord(realmId: string) {
      const branchId = realmRootBranchId.get(realmId);
      if (!branchId) return null;
      return { branchId };
    },

    async setRealmRoot(realmId: string, nodeKey: string) {
      const record = await this.getRealmRootRecord(realmId);
      if (!record) throw new Error("Realm root record not found");
      roots.set(record.branchId, nodeKey);
    },

    async ensureRealmRoot(realmId: string, emptyRootKey: string) {
      if (realmRootBranchId.has(realmId)) return;
      const branchId = crypto.randomUUID();
      await this.insertBranch({
        branchId,
        realmId,
        parentId: null,
        mountPath: "",
        expiresAt: 0,
      });
      realmRootBranchId.set(realmId, branchId);
      await this.setBranchRoot(branchId, emptyRootKey);
    },

    async getBranchRoot(branchId: string) {
      return roots.get(branchId) ?? null;
    },

    async setBranchRoot(branchId: string, nodeKey: string) {
      roots.set(branchId, nodeKey);
    },

    async listBranches(realmId: string) {
      return Array.from(branches.values()).filter(
        (b) => b.realmId === realmId && b.parentId !== null
      );
    },

    async insertBranch(branch: Branch) {
      branches.set(branch.branchId, branch);
    },

    async removeBranch(branchId: string) {
      branches.delete(branchId);
      roots.delete(branchId);
      for (const [realmId, id] of realmRootBranchId) {
        if (id === branchId) {
          realmRootBranchId.delete(realmId);
          break;
        }
      }
    },

    async purgeExpiredBranches(expiredBefore: number) {
      let count = 0;
      for (const [id, b] of branches) {
        if (b.parentId !== null && b.expiresAt < expiredBefore) {
          branches.delete(id);
          roots.delete(id);
          count++;
        }
      }
      return count;
    },
  };
}
