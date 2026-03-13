/**
 * Per-realm usage metadata: retained keys at last GC + new keys since then.
 * Usage = union of these two sets; no DAG traversal on read.
 * keyTimestamps: when each key was first recorded (for GC protection period).
 */
export type RealmUsageData = {
  retainedKeys: string[];
  newKeysSinceGc: string[];
  lastGcTime: number;
  /** key -> timestamp (ms) when key was recorded; used to include protection-period keys in retained. */
  keyTimestamps: Record<string, number>;
};

export type RealmUsageStore = {
  get(realmId: string): Promise<RealmUsageData | null>;
  setRetained(realmId: string, retainedKeys: string[], lastGcTime: number): Promise<void>;
  appendNewKey(realmId: string, key: string, timestamp?: number): Promise<void>;
  clearNewKeys(realmId: string): Promise<void>;
};

export function createMemoryRealmUsageStore(): RealmUsageStore {
  const dataByRealm = new Map<string, RealmUsageData>();

  return {
    async get(realmId: string) {
      return dataByRealm.get(realmId) ?? null;
    },

    async setRetained(realmId: string, retainedKeys: string[], lastGcTime: number) {
      const existing = dataByRealm.get(realmId);
      const keyTimestamps = existing?.keyTimestamps ?? {};
      dataByRealm.set(realmId, {
        retainedKeys: [...retainedKeys],
        newKeysSinceGc: [],
        lastGcTime,
        keyTimestamps: { ...keyTimestamps },
      });
    },

    async appendNewKey(realmId: string, key: string, timestamp?: number) {
      let data = dataByRealm.get(realmId);
      if (!data) {
        data = { retainedKeys: [], newKeysSinceGc: [], lastGcTime: 0, keyTimestamps: {} };
        dataByRealm.set(realmId, data);
      }
      const ts = timestamp ?? Date.now();
      if (data.keyTimestamps[key] === undefined) data.keyTimestamps[key] = ts;
      if (!data.newKeysSinceGc.includes(key)) {
        data.newKeysSinceGc.push(key);
      }
    },

    async clearNewKeys(realmId: string) {
      const data = dataByRealm.get(realmId);
      if (data) data.newKeysSinceGc = [];
    },
  };
}
