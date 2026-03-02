/**
 * Realm info and GC using CAS and BranchStore.
 */
import type { CasFacade } from "@casfa/cas";
import type { BranchStore } from "../db/branch-store.ts";
import type { DelegateGrantStore } from "../db/delegate-grants.ts";

export type RealmInfoResult = {
  lastGcTime: number | null;
  nodeCount: number;
  totalBytes: number;
  branchCount: number;
  delegateCount: number;
};

export type RealmInfoServiceDeps = {
  cas: CasFacade;
  branchStore: BranchStore;
  delegateGrantStore: DelegateGrantStore;
};

export type RealmInfoService = {
  info(realmId: string): Promise<RealmInfoResult>;
  gc(realmId: string, cutOffTime: number): Promise<void>;
};

export function createRealmInfoService(deps: RealmInfoServiceDeps): RealmInfoService {
  return {
    async info(realmId: string) {
      const casInfo = await deps.cas.info();
      const branches = await deps.branchStore.listBranches(realmId);
      const grants = await deps.delegateGrantStore.list(realmId);
      return {
        lastGcTime: casInfo.lastGcTime,
        nodeCount: casInfo.nodeCount,
        totalBytes: casInfo.totalBytes,
        branchCount: branches.length,
        delegateCount: grants.length,
      };
    },

    async gc(realmId: string, cutOffTime: number) {
      const rootKey = await deps.branchStore.getRealmRoot(realmId);
      const branches = await deps.branchStore.listBranches(realmId);
      const keys: string[] = [];
      if (rootKey) keys.push(rootKey);
      for (const b of branches) {
        const k = await deps.branchStore.getBranchRoot(b.branchId);
        if (k) keys.push(k);
      }
      await deps.cas.gc(keys, cutOffTime);
    },
  };
}
