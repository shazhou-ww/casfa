/**
 * In-memory settings store for unit tests.
 */
import type { Setting } from "../../types.ts";
import type { SettingsStore } from "../../db/settings-store.ts";

export function createMemorySettingsStore(): SettingsStore {
  const byKey = new Map<string, { value: unknown; updatedAt: number }>();

  function key(realmId: string, k: string): string {
    return `REALM#${realmId}#SETTING#${k}`;
  }

  return {
    async list(realmId) {
      const prefix = `REALM#${realmId}#SETTING#`;
      const items: Setting[] = [];
      for (const [k, v] of byKey.entries()) {
        if (k.startsWith(prefix)) {
          const settingKey = k.slice(prefix.length);
          items.push({ key: settingKey, value: v.value, updatedAt: v.updatedAt });
        }
      }
      return items;
    },

    async get(realmId, k) {
      const v = byKey.get(key(realmId, k));
      return v ? { value: v.value, updatedAt: v.updatedAt } : null;
    },

    async set(realmId, k, value) {
      const now = Date.now();
      byKey.set(key(realmId, k), { value, updatedAt: now });
      return { key: k, value, updatedAt: now };
    },
  };
}
