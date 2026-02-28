import type { Delegate, RealmStats } from "./types.ts";

/**
 * Blob storage for CAS nodes. Keys are node keys (e.g. CB32).
 * sweep(keysToRetain) keeps only those keys and removes the rest transactionally.
 */
export type BlobStore = {
  get: (key: string) => Promise<Uint8Array | null>;
  put: (key: string, value: Uint8Array) => Promise<void>;
  sweep: (keysToRetain: Set<string>) => Promise<void>;
};

/**
 * Delegate DB: realm root, delegates, and realm stats.
 * Stats: increment on put, full recompute on GC (setRealmStats).
 */
export type DelegateDb = {
  getRoot: (realmId: string) => Promise<string | null>;
  setRoot: (realmId: string, nodeKey: string) => Promise<void>;
  getDelegate: (delegateId: string) => Promise<Delegate | null>;
  insertDelegate: (delegate: Delegate) => Promise<void>;

  getRealmStats: (realmId: string) => Promise<RealmStats | null>;
  incrementRealmStats: (
    realmId: string,
    nodeCountDelta: number,
    bytesDelta: number
  ) => Promise<void>;
  setRealmStats: (realmId: string, stats: RealmStats) => Promise<void>;
};
