/**
 * Realm info and GC using CAS and BranchStore.
 * Usage = keys retained at last GC + new keys since then (no DAG traversal on read).
 */
import type { CasFacade } from "@casfa/cas";
import { bytesFromStream } from "@casfa/cas";
import type { OAuthServer } from "@casfa/cell-oauth";
import type { KeyProvider } from "@casfa/core";
import { hashToKey } from "@casfa/core";
import type { BranchStore } from "../db/branch-store.ts";
import type { RealmUsageStore } from "../db/realm-usage-store.ts";
import { ensureEmptyRoot, getNodeDecoded } from "./root-resolver.ts";

export type RealmInfoResult = {
  lastGcTime: number | null;
  nodeCount: number;
  totalBytes: number;
  branchCount: number;
  delegateCount: number;
};

export type RealmInfoServiceDeps = {
  cas: CasFacade;
  key: KeyProvider;
  branchStore: BranchStore;
  oauthServer: OAuthServer;
  realmUsageStore: RealmUsageStore;
};

export type RealmInfoService = {
  info(realmId: string): Promise<RealmInfoResult>;
  gc(realmId: string, cutOffTime: number): Promise<void>;
  recordNewKey(realmId: string, nodeKey: string): void;
  /** Lazy-create realm root if missing (e.g. mock user with no OAuth). Idempotent; DynamoDB uses create-if-not-exist. */
  ensureRealmForUser(realmId: string): Promise<void>;
};

/** One-time BFS from root keys to collect all reachable node keys. */
async function computeReachable(
  cas: CasFacade,
  keyProvider: KeyProvider,
  rootKeys: string[]
): Promise<string[]> {
  const seen = new Set<string>();
  const queue = rootKeys.filter(Boolean);
  while (queue.length > 0) {
    const key = queue.pop()!;
    if (seen.has(key)) continue;
    seen.add(key);
    const node = await getNodeDecoded(cas, key);
    if (!node) continue;
    const childHashes = node.children ?? [];
    for (const h of childHashes) {
      queue.push(hashToKey(h));
    }
  }
  return [...seen];
}

export function createRealmInfoService(deps: RealmInfoServiceDeps): RealmInfoService {
  return {
    async info(realmId: string) {
      let data = await deps.realmUsageStore.get(realmId);
      const branches = await deps.branchStore.listBranches(realmId);
      const grants = await deps.oauthServer.listDelegates(realmId);

      // When we have no stored data (e.g. realm existed before this feature), do one-time bootstrap:
      // compute reachable from roots and save as retained so usage is non-zero without running GC.
      if (!data || (data.retainedKeys.length === 0 && data.newKeysSinceGc.length === 0)) {
        const rootKey = await deps.branchStore.getRealmRoot(realmId);
        const rootKeys: string[] = [];
        if (rootKey) rootKeys.push(rootKey);
        for (const b of branches) {
          const k = await deps.branchStore.getBranchRoot(b.branchId);
          if (k) rootKeys.push(k);
        }
        if (rootKeys.length > 0) {
          const bootstrapRetained = await computeReachable(deps.cas, deps.key, rootKeys);
          await deps.realmUsageStore.setRetained(realmId, bootstrapRetained, 0);
          data = await deps.realmUsageStore.get(realmId);
        }
      }

      let nodeCount = 0;
      let totalBytes = 0;
      let lastGcTime: number | null = null;

      if (data && (data.retainedKeys.length > 0 || data.newKeysSinceGc.length > 0)) {
        const allKeys = new Set<string>([...data.retainedKeys, ...data.newKeysSinceGc]);
        lastGcTime = data.lastGcTime > 0 ? data.lastGcTime : null;
        for (const key of allKeys) {
          const result = await deps.cas.getNode(key);
          if (result) {
            const bytes = await bytesFromStream(result.body);
            totalBytes += bytes.length;
            nodeCount += 1;
          }
        }
      }

      return {
        lastGcTime,
        nodeCount,
        totalBytes,
        branchCount: branches.length,
        delegateCount: grants.length,
      };
    },

    async gc(realmId: string, cutOffTime: number) {
      const rootKey = await deps.branchStore.getRealmRoot(realmId);
      const branches = await deps.branchStore.listBranches(realmId);
      const rootKeys: string[] = [];
      if (rootKey) rootKeys.push(rootKey);
      for (const b of branches) {
        const k = await deps.branchStore.getBranchRoot(b.branchId);
        if (k) rootKeys.push(k);
      }
      const reachable = await computeReachable(deps.cas, deps.key, rootKeys);
      const reachableSet = new Set<string>(reachable);

      // Include keys that are no longer reachable but still in protection period (written after cutOffTime).
      const data = await deps.realmUsageStore.get(realmId);
      if (data?.keyTimestamps) {
        const allKnown = [...data.retainedKeys, ...data.newKeysSinceGc];
        for (const k of allKnown) {
          if ((data.keyTimestamps[k] ?? 0) > cutOffTime) reachableSet.add(k);
        }
      }
      const retained = [...reachableSet];

      await deps.cas.gc(rootKeys, cutOffTime);
      await deps.realmUsageStore.setRetained(realmId, retained, Date.now());
      await deps.realmUsageStore.clearNewKeys(realmId);
    },

    recordNewKey(realmId: string, nodeKey: string) {
      deps.realmUsageStore.appendNewKey(realmId, nodeKey).catch(() => {});
    },

    async ensureRealmForUser(realmId: string) {
      const emptyKey = await ensureEmptyRoot(deps.cas, deps.key);
      await deps.branchStore.ensureRealmRoot(realmId, emptyKey);
    },
  };
}
