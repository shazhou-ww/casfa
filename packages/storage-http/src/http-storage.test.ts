/**
 * Unit tests for createHttpStorage
 *
 * Uses mock CasfaClient to verify the logic of:
 * - get: delegates to client.nodes.get
 * - has: calls check, returns true only when owned
 * - put: check → put (missing) / claim (unowned) / no-op (owned)
 * - check-result caching across has/put calls
 */

import { describe, expect, it } from "bun:test";
import type { CasfaClient } from "@casfa/client";
import type { PopContext } from "@casfa/proof";
import { storageKeyToNodeKey } from "@casfa/protocol";
import { createHttpStorage, type HttpStorageConfig } from "./http-storage.ts";

// ============================================================================
// Mock helpers
// ============================================================================

/** A storage key (26-char CB32, no prefix) */
const KEY_A = "00000000000000000000000000";
const KEY_B = "11111111111111111111111110";

/** Corresponding node keys (with nod_ prefix) */
const NOD_A = storageKeyToNodeKey(KEY_A);
const NOD_B = storageKeyToNodeKey(KEY_B);

const BYTES_A = new Uint8Array([1, 2, 3]);

type Call = { method: string; args: unknown[] };

/**
 * Build a minimal mock CasfaClient that records calls and returns
 * pre-configured responses.
 */
function createMockClient(opts: {
  getResult?: { ok: boolean; data?: Uint8Array; error?: { message: string } };
  checkResult?: {
    ok: boolean;
    data?: { owned: string[]; unowned: string[]; missing: string[] };
    error?: { message: string };
  };
  putResult?: { ok: boolean; error?: { message: string } };
  claimResult?: { ok: boolean; error?: { message: string } };
}) {
  const calls: Call[] = [];

  const client = {
    nodes: {
      get: async (nodeKey: string) => {
        calls.push({ method: "nodes.get", args: [nodeKey] });
        return opts.getResult ?? { ok: true, data: BYTES_A, status: 200 };
      },
      check: async (params: { keys: string[] }) => {
        calls.push({ method: "nodes.check", args: [params] });
        return (
          opts.checkResult ?? {
            ok: true,
            data: { owned: [], unowned: [], missing: params.keys },
            status: 200,
          }
        );
      },
      put: async (nodeKey: string, _content: Uint8Array) => {
        calls.push({ method: "nodes.put", args: [nodeKey] });
        return (
          opts.putResult ?? {
            ok: true,
            data: { nodeKey, status: "created" },
            status: 201,
          }
        );
      },
      claim: async (nodeKey: string, pop: string) => {
        calls.push({ method: "nodes.claim", args: [nodeKey, pop] });
        return (
          opts.claimResult ?? {
            ok: true,
            data: { nodeHash: nodeKey, alreadyOwned: false, delegateId: "dlg_x" },
            status: 200,
          }
        );
      },
    },
  } as unknown as CasfaClient;

  return { client, calls };
}

const TOKEN_BYTES = new Uint8Array(32).fill(0xab);

const mockPopContext: PopContext = {
  blake3_256: (data: Uint8Array) => data.slice(0, 32),
  blake3_128_keyed: (data: Uint8Array, _key: Uint8Array) => data.slice(0, 16),
  crockfordBase32Encode: (_bytes: Uint8Array) => "MOCKPOP",
};

function makeConfig(
  client: CasfaClient,
  overrides: Partial<HttpStorageConfig> = {}
): HttpStorageConfig {
  return {
    client,
    getTokenBytes: () => TOKEN_BYTES,
    popContext: mockPopContext,
    ...overrides,
  };
}

// ============================================================================
// Tests — get
// ============================================================================

describe("createHttpStorage", () => {
  describe("get", () => {
    it("should return data when nodes.get succeeds", async () => {
      const { client } = createMockClient({
        getResult: { ok: true, data: BYTES_A },
      });
      const storage = createHttpStorage(makeConfig(client));

      const result = await storage.get(KEY_A);
      expect(result).toEqual(BYTES_A);
    });

    it("should return null when nodes.get fails", async () => {
      const { client } = createMockClient({
        getResult: { ok: false, error: { message: "not found" } },
      });
      const storage = createHttpStorage(makeConfig(client));

      const result = await storage.get(KEY_A);
      expect(result).toBeNull();
    });

    it("should convert storage key to node key", async () => {
      const { client, calls } = createMockClient({
        getResult: { ok: true, data: BYTES_A },
      });
      const storage = createHttpStorage(makeConfig(client));

      await storage.get(KEY_A);
      expect(calls[0]).toEqual({ method: "nodes.get", args: [NOD_A] });
    });
  });

  // ==========================================================================
  // Tests — has
  // ==========================================================================

  describe("has", () => {
    it("should return true when node is owned", async () => {
      const { client } = createMockClient({
        checkResult: {
          ok: true,
          data: { owned: [NOD_A], unowned: [], missing: [] },
        },
      });
      const storage = createHttpStorage(makeConfig(client));

      expect(await storage.has(KEY_A)).toBe(true);
    });

    it("should return false when node is unowned", async () => {
      const { client } = createMockClient({
        checkResult: {
          ok: true,
          data: { owned: [], unowned: [NOD_A], missing: [] },
        },
      });
      const storage = createHttpStorage(makeConfig(client));

      expect(await storage.has(KEY_A)).toBe(false);
    });

    it("should return false when node is missing", async () => {
      const { client } = createMockClient({
        checkResult: {
          ok: true,
          data: { owned: [], unowned: [], missing: [NOD_A] },
        },
      });
      const storage = createHttpStorage(makeConfig(client));

      expect(await storage.has(KEY_A)).toBe(false);
    });

    it("should throw when check fails", async () => {
      const { client } = createMockClient({
        checkResult: { ok: false, error: { message: "server down" } },
      });
      const storage = createHttpStorage(makeConfig(client));

      await expect(storage.has(KEY_A)).rejects.toThrow("Failed to check node");
    });
  });

  // ==========================================================================
  // Tests — put
  // ==========================================================================

  describe("put", () => {
    it("should upload when node is missing", async () => {
      const { client, calls } = createMockClient({
        checkResult: {
          ok: true,
          data: { owned: [], unowned: [], missing: [NOD_A] },
        },
      });
      const storage = createHttpStorage(makeConfig(client));

      await storage.put(KEY_A, BYTES_A);

      expect(calls.map((c) => c.method)).toEqual(["nodes.check", "nodes.put"]);
    });

    it("should claim when node is unowned", async () => {
      const { client, calls } = createMockClient({
        checkResult: {
          ok: true,
          data: { owned: [], unowned: [NOD_A], missing: [] },
        },
      });
      const storage = createHttpStorage(makeConfig(client));

      await storage.put(KEY_A, BYTES_A);

      expect(calls.map((c) => c.method)).toEqual(["nodes.check", "nodes.claim"]);
    });

    it("should no-op when node is already owned", async () => {
      const { client, calls } = createMockClient({
        checkResult: {
          ok: true,
          data: { owned: [NOD_A], unowned: [], missing: [] },
        },
      });
      const storage = createHttpStorage(makeConfig(client));

      await storage.put(KEY_A, BYTES_A);

      // Only the check call — no put or claim
      expect(calls.map((c) => c.method)).toEqual(["nodes.check"]);
    });

    it("should throw when put fails", async () => {
      const { client } = createMockClient({
        checkResult: {
          ok: true,
          data: { owned: [], unowned: [], missing: [NOD_A] },
        },
        putResult: { ok: false, error: { message: "disk full" } },
      });
      const storage = createHttpStorage(makeConfig(client));

      await expect(storage.put(KEY_A, BYTES_A)).rejects.toThrow("Failed to upload node");
    });

    it("should throw when claim fails", async () => {
      const { client } = createMockClient({
        checkResult: {
          ok: true,
          data: { owned: [], unowned: [NOD_A], missing: [] },
        },
        claimResult: { ok: false, error: { message: "bad pop" } },
      });
      const storage = createHttpStorage(makeConfig(client));

      await expect(storage.put(KEY_A, BYTES_A)).rejects.toThrow("Failed to claim node");
    });

    it("should throw when claiming without tokenBytes", async () => {
      const { client } = createMockClient({
        checkResult: {
          ok: true,
          data: { owned: [], unowned: [NOD_A], missing: [] },
        },
      });
      const storage = createHttpStorage({
        client,
        getTokenBytes: () => null,
        popContext: mockPopContext,
      });

      await expect(storage.put(KEY_A, BYTES_A)).rejects.toThrow("missing tokenBytes or popContext");
    });

    it("should throw when claiming without popContext", async () => {
      const { client } = createMockClient({
        checkResult: {
          ok: true,
          data: { owned: [], unowned: [NOD_A], missing: [] },
        },
      });
      const storage = createHttpStorage({
        client,
        getTokenBytes: () => TOKEN_BYTES,
        popContext: undefined,
      });

      await expect(storage.put(KEY_A, BYTES_A)).rejects.toThrow("missing tokenBytes or popContext");
    });
  });

  // ==========================================================================
  // Tests — check cache
  // ==========================================================================

  describe("check cache", () => {
    it("should not call check twice for same key (has → has)", async () => {
      const { client, calls } = createMockClient({
        checkResult: {
          ok: true,
          data: { owned: [NOD_A], unowned: [], missing: [] },
        },
      });
      const storage = createHttpStorage(makeConfig(client));

      await storage.has(KEY_A);
      await storage.has(KEY_A);

      const checkCalls = calls.filter((c) => c.method === "nodes.check");
      expect(checkCalls).toHaveLength(1);
    });

    it("should reuse check result between has and put", async () => {
      const { client, calls } = createMockClient({
        checkResult: {
          ok: true,
          data: { owned: [], unowned: [], missing: [NOD_A] },
        },
      });
      const storage = createHttpStorage(makeConfig(client));

      // has first — caches "missing"
      const hasResult = await storage.has(KEY_A);
      expect(hasResult).toBe(false);

      // put second — should use cached "missing", then do put
      await storage.put(KEY_A, BYTES_A);

      const checkCalls = calls.filter((c) => c.method === "nodes.check");
      expect(checkCalls).toHaveLength(1);

      const putCalls = calls.filter((c) => c.method === "nodes.put");
      expect(putCalls).toHaveLength(1);
    });

    it("should update cache to owned after successful put", async () => {
      const { client, calls } = createMockClient({
        checkResult: {
          ok: true,
          data: { owned: [], unowned: [], missing: [NOD_A] },
        },
      });
      const storage = createHttpStorage(makeConfig(client));

      await storage.put(KEY_A, BYTES_A);

      // Overwrite the check mock to return a different result, but
      // it should NOT be called because the cache was updated to "owned"
      // after the put above.

      // has should return true now (from cache)
      // We need to NOT reset the mock, the cache should handle it.
      // Since put updated cache to "owned", has should be true without another check.
      // The mock's checkResult still says missing, but cache overrides it.
      const hasResult = await storage.has(KEY_A);
      expect(hasResult).toBe(true);

      // Only 1 check call total
      const checkCalls = calls.filter((c) => c.method === "nodes.check");
      expect(checkCalls).toHaveLength(1);
    });

    it("should update cache to owned after successful claim", async () => {
      const { client, calls } = createMockClient({
        checkResult: {
          ok: true,
          data: { owned: [], unowned: [NOD_A], missing: [] },
        },
      });
      const storage = createHttpStorage(makeConfig(client));

      await storage.put(KEY_A, BYTES_A);
      const hasResult = await storage.has(KEY_A);

      expect(hasResult).toBe(true);

      const checkCalls = calls.filter((c) => c.method === "nodes.check");
      expect(checkCalls).toHaveLength(1);
    });

    it("should cache independently per key", async () => {
      let checkCallCount = 0;
      const client = {
        nodes: {
          check: async (params: { keys: string[] }) => {
            checkCallCount++;
            const key = params.keys[0];
            if (key === NOD_A) {
              return { ok: true, data: { owned: [NOD_A], unowned: [], missing: [] }, status: 200 };
            }
            return { ok: true, data: { owned: [], unowned: [], missing: [NOD_B] }, status: 200 };
          },
          put: async () => ({ ok: true, data: { status: "created" }, status: 201 }),
        },
      } as unknown as CasfaClient;

      const storage = createHttpStorage(makeConfig(client));

      expect(await storage.has(KEY_A)).toBe(true); // check call #1
      expect(await storage.has(KEY_B)).toBe(false); // check call #2
      expect(await storage.has(KEY_A)).toBe(true); // cached
      expect(await storage.has(KEY_B)).toBe(false); // cached

      expect(checkCallCount).toBe(2);
    });
  });
});
