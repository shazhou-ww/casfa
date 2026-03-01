export type DeriveKey = "path_index" | "dir_entries" | "realm_stats";

export type DerivedDataStore = {
  get<T = unknown>(nodeKey: string, deriveKey: DeriveKey): Promise<T | null>;
  set(nodeKey: string, deriveKey: DeriveKey, data: unknown): Promise<void>;
  has(nodeKey: string, deriveKey: DeriveKey): Promise<boolean>;
  delete(nodeKey: string, deriveKey: DeriveKey): Promise<void>;
};

export function createMemoryDerivedDataStore(): DerivedDataStore {
  const map = new Map<string, unknown>();

  function key(nodeKey: string, deriveKey: DeriveKey): string {
    return `${nodeKey}:${deriveKey}`;
  }

  return {
    async get<T = unknown>(nodeKey: string, deriveKey: DeriveKey) {
      return (map.get(key(nodeKey, deriveKey)) ?? null) as T | null;
    },
    async set(nodeKey: string, deriveKey: DeriveKey, data: unknown) {
      map.set(key(nodeKey, deriveKey), data);
    },
    async has(nodeKey: string, deriveKey: DeriveKey) {
      return map.has(key(nodeKey, deriveKey));
    },
    async delete(nodeKey: string, deriveKey: DeriveKey) {
      map.delete(key(nodeKey, deriveKey));
    },
  };
}
