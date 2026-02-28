/**
 * RealmService placeholder test: instantiate with in-memory CAS and DepotStore.
 */
import { describe, expect, it } from "bun:test";
import { createCasService } from "@casfa/cas";
import type { CasStorage } from "@casfa/cas";
import type { KeyProvider } from "@casfa/core";
import { computeSizeFlagByte } from "@casfa/core";
import { createMemoryStorage } from "@casfa/storage-memory";
import { RealmService } from "../src/realm-service.ts";
import type { Depot, DepotStore } from "../src/types.ts";

function createKeyProvider(): KeyProvider {
  return {
    computeKey: async (data: Uint8Array) => {
      const { blake3 } = await import("@noble/hashes/blake3");
      const raw = blake3(data, { dkLen: 16 });
      raw[0] = computeSizeFlagByte(data.length);
      return raw;
    },
  };
}

function createMemoryDepotStore(): DepotStore {
  const depots = new Map<string, Depot>();
  const roots = new Map<string, string>();
  return {
    getDepot: async (depotId) => depots.get(depotId) ?? null,
    getRoot: async (depotId) => roots.get(depotId) ?? null,
    setRoot: async (depotId, nodeKey) => {
      roots.set(depotId, nodeKey);
    },
    listDepots: async (realmId) =>
      [...depots.values()].filter((d) => d.realmId === realmId),
    insertDepot: async (depot) => {
      depots.set(depot.depotId, depot);
    },
    removeDepot: async (depotId) => {
      depots.delete(depotId);
      roots.delete(depotId);
    },
  };
}

describe("RealmService", () => {
  it("instantiates with in-memory CAS and DepotStore", () => {
    const mem = createMemoryStorage();
    const storage: CasStorage = {
      get: mem.get.bind(mem),
      put: mem.put.bind(mem),
      del: mem.del.bind(mem),
    };
    const cas = createCasService({ storage, key: createKeyProvider() });
    const depotStore = createMemoryDepotStore();
    const service = new RealmService({ cas, depotStore });
    expect(service).toBeDefined();
    expect(service.cas).toBe(cas);
    expect(service.depotStore).toBe(depotStore);
  });
});
