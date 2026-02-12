/**
 * Unit tests for createSyncManager (Layer 2: Depot Commit Sync)
 *
 * Uses in-memory mocks for FlushableStorage, CasfaClient, and SyncQueueStore
 * to verify:
 * - enqueue: basic, merge semantics (targetRoot updated, lastKnownServerRoot stays)
 * - debounce: multiple puts collapse into one sync
 * - sync cycle: flush Layer 1 → get depot → conflict detect → commit → remove
 * - conflict detection: LWW-overwrite + event emission
 * - flush failure: abort sync, schedule retry
 * - retry: exponential backoff, max retry count
 * - recover: load from store, trigger sync
 * - flushNow: immediate sync (no debounce)
 * - dispose: cancel timers, ignore enqueue
 * - onStateChange / onConflict: listener lifecycle
 */

import { describe, expect, it, mock } from "bun:test";
import type { CasfaClient } from "@casfa/client";
import type {
  ConflictEvent,
  DepotSyncEntry,
  FlushableStorage,
  SyncQueueStore,
  SyncState,
} from "./sync-manager.ts";
import { createSyncManager } from "./sync-manager.ts";

// ============================================================================
// Helpers
// ============================================================================

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Short debounce for tests */
const DEBOUNCE = 30;

// ── In-memory SyncQueueStore ──

function createMemoryQueueStore(): SyncQueueStore & {
  entries: Map<string, DepotSyncEntry>;
} {
  const entries = new Map<string, DepotSyncEntry>();
  return {
    entries,
    async loadAll() {
      return [...entries.values()];
    },
    async upsert(entry) {
      entries.set(entry.depotId, entry);
    },
    async remove(depotId) {
      entries.delete(depotId);
    },
  };
}

// ── Mock FlushableStorage ──

function createMockStorage(opts?: {
  flushFn?: () => Promise<void>;
}): FlushableStorage & { flushCount: number } {
  let flushCount = 0;
  return {
    get flushCount() {
      return flushCount;
    },
    async flush() {
      flushCount++;
      if (opts?.flushFn) await opts.flushFn();
    },
  };
}

// ── Mock CasfaClient (only depots.get + depots.commit) ──

type DepotState = {
  root: string | null;
  depotId: string;
};

function createMockClient(opts?: {
  depots?: Map<string, DepotState>;
  getFn?: (depotId: string) => Promise<any>;
  commitFn?: (depotId: string, params: { root: string }) => Promise<any>;
}): CasfaClient {
  const depots = opts?.depots ?? new Map<string, DepotState>();

  return {
    depots: {
      get:
        opts?.getFn ??
        (async (depotId: string) => {
          const d = depots.get(depotId);
          if (!d) {
            return {
              ok: false,
              error: { code: "not_found", message: "Depot not found" },
            };
          }
          return {
            ok: true,
            data: {
              depotId: d.depotId,
              root: d.root,
              title: null,
              maxHistory: 10,
              history: [],
              creatorIssuerId: "test",
              createdAt: 0,
              updatedAt: 0,
            },
            status: 200,
          };
        }),
      commit:
        opts?.commitFn ??
        (async (depotId: string, params: { root: string }) => {
          const d = depots.get(depotId);
          if (d) d.root = params.root;
          return {
            ok: true,
            data: {
              depotId,
              root: params.root,
              updatedAt: Date.now(),
            },
            status: 200,
          };
        }),
      // Unused stubs
      create: async () => ({ ok: false, error: { code: "stub", message: "stub" } }),
      list: async () => ({ ok: false, error: { code: "stub", message: "stub" } }),
      update: async () => ({ ok: false, error: { code: "stub", message: "stub" } }),
      delete: async () => ({ ok: false, error: { code: "stub", message: "stub" } }),
    },
  } as unknown as CasfaClient;
}

// ============================================================================
// Tests
// ============================================================================

describe("createSyncManager", () => {
  // --------------------------------------------------------------------------
  // enqueue
  // --------------------------------------------------------------------------

  describe("enqueue", () => {
    it("should add entry to queue store", async () => {
      const store = createMemoryQueueStore();
      const storage = createMockStorage();
      const depots = new Map([["d1", { depotId: "d1", root: "rootA" }]]);
      const client = createMockClient({ depots });

      const mgr = createSyncManager({
        storage,
        client,
        queueStore: store,
        debounceMs: DEBOUNCE,
      });

      mgr.enqueue("d1", "rootB", "rootA");

      // Give microtask for async upsert
      await wait(5);

      expect(store.entries.size).toBe(1);
      const entry = store.entries.get("d1")!;
      expect(entry.targetRoot).toBe("rootB");
      expect(entry.lastKnownServerRoot).toBe("rootA");
      expect(entry.retryCount).toBe(0);
      expect(mgr.getPendingCount()).toBe(1);

      mgr.dispose();
    });

    it("should merge: update targetRoot but keep lastKnownServerRoot", async () => {
      const store = createMemoryQueueStore();
      const storage = createMockStorage();
      const client = createMockClient();

      const mgr = createSyncManager({
        storage,
        client,
        queueStore: store,
        debounceMs: DEBOUNCE,
      });

      mgr.enqueue("d1", "rootB", "rootA");
      await wait(5);
      mgr.enqueue("d1", "rootC", "rootB");
      await wait(5);

      expect(store.entries.size).toBe(1);
      const entry = store.entries.get("d1")!;
      // targetRoot should be latest
      expect(entry.targetRoot).toBe("rootC");
      // lastKnownServerRoot should stay from first enqueue
      expect(entry.lastKnownServerRoot).toBe("rootA");

      mgr.dispose();
    });

    it("should handle multiple depots independently", async () => {
      const store = createMemoryQueueStore();
      const storage = createMockStorage();
      const client = createMockClient();

      const mgr = createSyncManager({
        storage,
        client,
        queueStore: store,
        debounceMs: DEBOUNCE,
      });

      mgr.enqueue("d1", "rootB", "rootA");
      mgr.enqueue("d2", "rootX", "rootW");
      await wait(5);

      expect(store.entries.size).toBe(2);
      expect(store.entries.get("d1")!.targetRoot).toBe("rootB");
      expect(store.entries.get("d2")!.targetRoot).toBe("rootX");

      mgr.dispose();
    });

    it("should not enqueue after dispose", async () => {
      const store = createMemoryQueueStore();
      const storage = createMockStorage();
      const client = createMockClient();

      const mgr = createSyncManager({
        storage,
        client,
        queueStore: store,
        debounceMs: DEBOUNCE,
      });

      mgr.dispose();
      mgr.enqueue("d1", "rootB", "rootA");
      await wait(5);

      expect(store.entries.size).toBe(0);
      expect(mgr.getPendingCount()).toBe(0);
    });
  });

  // --------------------------------------------------------------------------
  // debounce + sync cycle
  // --------------------------------------------------------------------------

  describe("debounced sync", () => {
    it("should sync after debounce interval", async () => {
      const store = createMemoryQueueStore();
      const storage = createMockStorage();
      const depots = new Map([["d1", { depotId: "d1", root: "rootA" }]]);
      const client = createMockClient({ depots });

      const mgr = createSyncManager({
        storage,
        client,
        queueStore: store,
        debounceMs: DEBOUNCE,
      });

      mgr.enqueue("d1", "rootB", "rootA");

      // Not synced yet
      expect(depots.get("d1")!.root).toBe("rootA");

      // Wait for debounce + buffer
      await wait(DEBOUNCE + 100);

      // Should be committed
      expect(depots.get("d1")!.root).toBe("rootB");
      // Queue should be empty
      expect(store.entries.size).toBe(0);
      expect(mgr.getPendingCount()).toBe(0);

      mgr.dispose();
    });

    it("should merge rapid enqueues into one commit", async () => {
      const store = createMemoryQueueStore();
      const storage = createMockStorage();
      const depots = new Map([["d1", { depotId: "d1", root: "rootA" }]]);
      const commitCalls: string[] = [];
      const client = createMockClient({
        depots,
        commitFn: async (depotId, params) => {
          commitCalls.push(params.root);
          depots.get(depotId)!.root = params.root;
          return { ok: true, data: { depotId, root: params.root, updatedAt: Date.now() }, status: 200 };
        },
      });

      const mgr = createSyncManager({
        storage,
        client,
        queueStore: store,
        debounceMs: DEBOUNCE,
      });

      mgr.enqueue("d1", "rootB", "rootA");
      mgr.enqueue("d1", "rootC", "rootA");
      mgr.enqueue("d1", "rootD", "rootA");

      await wait(DEBOUNCE + 100);

      // Only one commit with the latest root
      expect(commitCalls).toEqual(["rootD"]);
      expect(depots.get("d1")!.root).toBe("rootD");

      mgr.dispose();
    });

    it("should call storage.flush() before commit", async () => {
      const events: string[] = [];
      const storage: FlushableStorage = {
        async flush() {
          events.push("flush");
        },
      };
      const depots = new Map([["d1", { depotId: "d1", root: "rootA" }]]);
      const client = createMockClient({
        depots,
        commitFn: async (depotId, params) => {
          events.push("commit");
          depots.get(depotId)!.root = params.root;
          return { ok: true, data: { depotId, root: params.root, updatedAt: Date.now() }, status: 200 };
        },
      });

      const store = createMemoryQueueStore();
      const mgr = createSyncManager({
        storage,
        client,
        queueStore: store,
        debounceMs: DEBOUNCE,
      });

      mgr.enqueue("d1", "rootB", "rootA");
      await wait(DEBOUNCE + 100);

      expect(events).toEqual(["flush", "commit"]);

      mgr.dispose();
    });
  });

  // --------------------------------------------------------------------------
  // state transitions
  // --------------------------------------------------------------------------

  describe("state transitions", () => {
    it("should transition idle → syncing → idle on success", async () => {
      const store = createMemoryQueueStore();
      const storage = createMockStorage();
      const depots = new Map([["d1", { depotId: "d1", root: "rootA" }]]);
      const client = createMockClient({ depots });
      const states: SyncState[] = [];

      const mgr = createSyncManager({
        storage,
        client,
        queueStore: store,
        debounceMs: DEBOUNCE,
      });

      mgr.onStateChange((s) => states.push(s));
      mgr.enqueue("d1", "rootB", "rootA");

      await wait(DEBOUNCE + 100);

      // idle (initial notification) → syncing → idle
      expect(states).toEqual(["idle", "syncing", "idle"]);

      mgr.dispose();
    });

    it("should notify state=error when flush fails", async () => {
      const store = createMemoryQueueStore();
      const storage = createMockStorage({
        flushFn: async () => {
          throw new Error("flush failed");
        },
      });
      const client = createMockClient();
      const states: SyncState[] = [];

      const mgr = createSyncManager({
        storage,
        client,
        queueStore: store,
        debounceMs: DEBOUNCE,
      });

      mgr.onStateChange((s) => states.push(s));
      mgr.enqueue("d1", "rootB", "rootA");

      await wait(DEBOUNCE + 100);

      expect(states).toContain("error");

      mgr.dispose();
    });

    it("should unsubscribe onStateChange correctly", async () => {
      const store = createMemoryQueueStore();
      const storage = createMockStorage();
      const depots = new Map([["d1", { depotId: "d1", root: "rootA" }]]);
      const client = createMockClient({ depots });
      const states: SyncState[] = [];

      const mgr = createSyncManager({
        storage,
        client,
        queueStore: store,
        debounceMs: DEBOUNCE,
      });

      const unsub = mgr.onStateChange((s) => states.push(s));
      unsub();

      mgr.enqueue("d1", "rootB", "rootA");
      await wait(DEBOUNCE + 100);

      // Only the initial notification before unsub
      expect(states).toEqual(["idle"]);

      mgr.dispose();
    });
  });

  // --------------------------------------------------------------------------
  // conflict detection
  // --------------------------------------------------------------------------

  describe("conflict detection", () => {
    it("should emit conflict when server root differs from lastKnownServerRoot", async () => {
      const store = createMemoryQueueStore();
      const storage = createMockStorage();
      // Server root was changed by another client: rootA → rootX
      const depots = new Map([["d1", { depotId: "d1", root: "rootX" }]]);
      const client = createMockClient({ depots });
      const conflicts: ConflictEvent[] = [];

      const mgr = createSyncManager({
        storage,
        client,
        queueStore: store,
        debounceMs: DEBOUNCE,
      });

      mgr.onConflict((e) => conflicts.push(e));
      // Client thinks server is at rootA, but it's actually at rootX
      mgr.enqueue("d1", "rootB", "rootA");

      await wait(DEBOUNCE + 100);

      expect(conflicts).toHaveLength(1);
      expect(conflicts[0]!.depotId).toBe("d1");
      expect(conflicts[0]!.localRoot).toBe("rootB");
      expect(conflicts[0]!.serverRoot).toBe("rootX");
      expect(conflicts[0]!.resolution).toBe("lww-overwrite");

      // Should still commit (LWW)
      expect(depots.get("d1")!.root).toBe("rootB");

      mgr.dispose();
    });

    it("should NOT emit conflict when server root matches lastKnownServerRoot", async () => {
      const store = createMemoryQueueStore();
      const storage = createMockStorage();
      const depots = new Map([["d1", { depotId: "d1", root: "rootA" }]]);
      const client = createMockClient({ depots });
      const conflicts: ConflictEvent[] = [];

      const mgr = createSyncManager({
        storage,
        client,
        queueStore: store,
        debounceMs: DEBOUNCE,
      });

      mgr.onConflict((e) => conflicts.push(e));
      mgr.enqueue("d1", "rootB", "rootA");

      await wait(DEBOUNCE + 100);

      expect(conflicts).toHaveLength(0);

      mgr.dispose();
    });

    it("should NOT emit conflict when lastKnownServerRoot is null", async () => {
      const store = createMemoryQueueStore();
      const storage = createMockStorage();
      const depots = new Map([["d1", { depotId: "d1", root: "rootX" }]]);
      const client = createMockClient({ depots });
      const conflicts: ConflictEvent[] = [];

      const mgr = createSyncManager({
        storage,
        client,
        queueStore: store,
        debounceMs: DEBOUNCE,
      });

      mgr.onConflict((e) => conflicts.push(e));
      mgr.enqueue("d1", "rootB", null);

      await wait(DEBOUNCE + 100);

      expect(conflicts).toHaveLength(0);
      // Should still commit
      expect(depots.get("d1")!.root).toBe("rootB");

      mgr.dispose();
    });

    it("should skip commit when server already has targetRoot", async () => {
      const store = createMemoryQueueStore();
      const storage = createMockStorage();
      // Server already has rootB — no need to commit
      const depots = new Map([["d1", { depotId: "d1", root: "rootB" }]]);
      const commitCalls: string[] = [];
      const client = createMockClient({
        depots,
        commitFn: async (_depotId, params) => {
          commitCalls.push(params.root);
          return { ok: true, data: { depotId: "d1", root: params.root, updatedAt: Date.now() }, status: 200 };
        },
      });

      const mgr = createSyncManager({
        storage,
        client,
        queueStore: store,
        debounceMs: DEBOUNCE,
      });

      mgr.enqueue("d1", "rootB", "rootA");
      await wait(DEBOUNCE + 100);

      // No commit needed — server already at target
      expect(commitCalls).toHaveLength(0);
      expect(store.entries.size).toBe(0);

      mgr.dispose();
    });
  });

  // --------------------------------------------------------------------------
  // flush failure
  // --------------------------------------------------------------------------

  describe("flush failure (Layer 1)", () => {
    it("should set error state and NOT commit when flush fails", async () => {
      const store = createMemoryQueueStore();
      const storage = createMockStorage({
        flushFn: async () => {
          throw new Error("network error");
        },
      });
      const depots = new Map([["d1", { depotId: "d1", root: "rootA" }]]);
      const commitCalls: string[] = [];
      const client = createMockClient({
        depots,
        commitFn: async (_depotId, params) => {
          commitCalls.push(params.root);
          return { ok: true, data: { depotId: "d1", root: params.root, updatedAt: Date.now() }, status: 200 };
        },
      });

      const mgr = createSyncManager({
        storage,
        client,
        queueStore: store,
        debounceMs: DEBOUNCE,
      });

      mgr.enqueue("d1", "rootB", "rootA");
      await wait(DEBOUNCE + 100);

      // Should NOT have committed (flush failed)
      expect(commitCalls).toHaveLength(0);
      expect(mgr.getState()).toBe("error");
      // Entry should still be in queue
      expect(mgr.getPendingCount()).toBe(1);

      mgr.dispose();
    });
  });

  // --------------------------------------------------------------------------
  // retry
  // --------------------------------------------------------------------------

  describe("retry", () => {
    it("should increment retryCount on commit failure", async () => {
      const store = createMemoryQueueStore();
      const storage = createMockStorage();
      const client = createMockClient({
        commitFn: async () => {
          throw new Error("server error");
        },
        getFn: async (depotId) => ({
          ok: true,
          data: { depotId, root: "rootA", title: null, maxHistory: 10, history: [], creatorIssuerId: "t", createdAt: 0, updatedAt: 0 },
          status: 200,
        }),
      });

      const mgr = createSyncManager({
        storage,
        client,
        queueStore: store,
        debounceMs: DEBOUNCE,
      });

      mgr.enqueue("d1", "rootB", "rootA");
      await wait(DEBOUNCE + 100);

      // Dispose to stop retries before checking
      mgr.dispose();

      // After at least one failure, retryCount should be >= 1
      const entry = store.entries.get("d1");
      expect(entry).toBeDefined();
      expect(entry!.retryCount).toBeGreaterThanOrEqual(1);
    });

    it("should give up after MAX_RETRY_COUNT (10)", async () => {
      const store = createMemoryQueueStore();
      // Pre-populate with an entry at max retries
      store.entries.set("d1", {
        depotId: "d1",
        targetRoot: "rootB",
        lastKnownServerRoot: "rootA",
        createdAt: 0,
        updatedAt: 0,
        retryCount: 10,
      });

      const storage = createMockStorage();
      const commitCalls: string[] = [];
      const client = createMockClient({
        getFn: async (depotId) => ({
          ok: true,
          data: { depotId, root: "rootA", title: null, maxHistory: 10, history: [], creatorIssuerId: "t", createdAt: 0, updatedAt: 0 },
          status: 200,
        }),
        commitFn: async (_depotId, params) => {
          commitCalls.push(params.root);
          return { ok: true, data: { depotId: "d1", root: params.root, updatedAt: Date.now() }, status: 200 };
        },
      });

      const mgr = createSyncManager({
        storage,
        client,
        queueStore: store,
        debounceMs: DEBOUNCE,
      });

      // Recover loads the maxed-out entry
      await mgr.recover();
      await wait(DEBOUNCE + 100);

      // Should NOT attempt commit (exceeded max retries)
      expect(commitCalls).toHaveLength(0);

      mgr.dispose();
    });
  });

  // --------------------------------------------------------------------------
  // recover
  // --------------------------------------------------------------------------

  describe("recover", () => {
    it("should load entries from store and trigger sync", async () => {
      const store = createMemoryQueueStore();
      // Pre-populate as if from previous session
      store.entries.set("d1", {
        depotId: "d1",
        targetRoot: "rootB",
        lastKnownServerRoot: "rootA",
        createdAt: 1000,
        updatedAt: 1000,
        retryCount: 0,
      });

      const storage = createMockStorage();
      const depots = new Map([["d1", { depotId: "d1", root: "rootA" }]]);
      const client = createMockClient({ depots });
      const states: SyncState[] = [];

      const mgr = createSyncManager({
        storage,
        client,
        queueStore: store,
        debounceMs: DEBOUNCE,
      });

      mgr.onStateChange((s) => states.push(s));
      await mgr.recover();
      await wait(DEBOUNCE + 100);

      // Should have synced
      expect(depots.get("d1")!.root).toBe("rootB");
      expect(store.entries.size).toBe(0);
      expect(states).toContain("recovering");
      expect(states).toContain("syncing");

      mgr.dispose();
    });

    it("should set idle when store is empty", async () => {
      const store = createMemoryQueueStore();
      const storage = createMockStorage();
      const client = createMockClient();

      const mgr = createSyncManager({
        storage,
        client,
        queueStore: store,
        debounceMs: DEBOUNCE,
      });

      const states: SyncState[] = [];
      mgr.onStateChange((s) => states.push(s));
      await mgr.recover();

      // idle → recovering → idle
      expect(states).toContain("idle");
      expect(mgr.getState()).toBe("idle");

      mgr.dispose();
    });
  });

  // --------------------------------------------------------------------------
  // flushNow
  // --------------------------------------------------------------------------

  describe("flushNow", () => {
    it("should sync immediately without waiting for debounce", async () => {
      const store = createMemoryQueueStore();
      const storage = createMockStorage();
      const depots = new Map([["d1", { depotId: "d1", root: "rootA" }]]);
      const client = createMockClient({ depots });

      const mgr = createSyncManager({
        storage,
        client,
        queueStore: store,
        debounceMs: 10_000, // very long debounce
      });

      mgr.enqueue("d1", "rootB", "rootA");
      await mgr.flushNow();

      // Should be committed immediately
      expect(depots.get("d1")!.root).toBe("rootB");
      expect(store.entries.size).toBe(0);
      expect(mgr.getState()).toBe("idle");

      mgr.dispose();
    });

    it("should be a no-op when queue is empty", async () => {
      const store = createMemoryQueueStore();
      const storage = createMockStorage();
      const client = createMockClient();

      const mgr = createSyncManager({
        storage,
        client,
        queueStore: store,
        debounceMs: DEBOUNCE,
      });

      // Should not throw
      await mgr.flushNow();
      expect(storage.flushCount).toBe(0);

      mgr.dispose();
    });
  });

  // --------------------------------------------------------------------------
  // dispose
  // --------------------------------------------------------------------------

  describe("dispose", () => {
    it("should cancel pending debounce timer", async () => {
      const store = createMemoryQueueStore();
      const storage = createMockStorage();
      const depots = new Map([["d1", { depotId: "d1", root: "rootA" }]]);
      const commitCalls: string[] = [];
      const client = createMockClient({
        depots,
        commitFn: async (_depotId, params) => {
          commitCalls.push(params.root);
          depots.get("d1")!.root = params.root;
          return { ok: true, data: { depotId: "d1", root: params.root, updatedAt: Date.now() }, status: 200 };
        },
      });

      const mgr = createSyncManager({
        storage,
        client,
        queueStore: store,
        debounceMs: DEBOUNCE,
      });

      mgr.enqueue("d1", "rootB", "rootA");
      mgr.dispose();

      // Wait past debounce
      await wait(DEBOUNCE + 100);

      // Should NOT have committed (timer was cancelled)
      expect(commitCalls).toHaveLength(0);
      expect(depots.get("d1")!.root).toBe("rootA");
    });

    it("should ignore enqueue after dispose", async () => {
      const store = createMemoryQueueStore();
      const storage = createMockStorage();
      const client = createMockClient();

      const mgr = createSyncManager({
        storage,
        client,
        queueStore: store,
        debounceMs: DEBOUNCE,
      });

      mgr.dispose();
      mgr.enqueue("d1", "rootB", "rootA");

      expect(mgr.getPendingCount()).toBe(0);
    });
  });

  // --------------------------------------------------------------------------
  // onConflict listener
  // --------------------------------------------------------------------------

  describe("onConflict", () => {
    it("should unsubscribe correctly", async () => {
      const store = createMemoryQueueStore();
      const storage = createMockStorage();
      const depots = new Map([["d1", { depotId: "d1", root: "rootX" }]]);
      const client = createMockClient({ depots });
      const conflicts: ConflictEvent[] = [];

      const mgr = createSyncManager({
        storage,
        client,
        queueStore: store,
        debounceMs: DEBOUNCE,
      });

      const unsub = mgr.onConflict((e) => conflicts.push(e));
      unsub();

      mgr.enqueue("d1", "rootB", "rootA");
      await wait(DEBOUNCE + 100);

      // Should not have received conflict (unsubscribed)
      expect(conflicts).toHaveLength(0);

      mgr.dispose();
    });
  });

  // --------------------------------------------------------------------------
  // commit error response (ok: false)
  // --------------------------------------------------------------------------

  describe("commit error handling", () => {
    it("should increment retryCount when commit returns ok:false", async () => {
      const store = createMemoryQueueStore();
      const storage = createMockStorage();
      const client = createMockClient({
        getFn: async (depotId) => ({
          ok: true,
          data: { depotId, root: "rootA", title: null, maxHistory: 10, history: [], creatorIssuerId: "t", createdAt: 0, updatedAt: 0 },
          status: 200,
        }),
        commitFn: async () => ({
          ok: false,
          error: { code: "server_error", message: "Internal server error" },
        }),
      });

      const mgr = createSyncManager({
        storage,
        client,
        queueStore: store,
        debounceMs: DEBOUNCE,
      });

      mgr.enqueue("d1", "rootB", "rootA");
      await wait(DEBOUNCE + 100);
      mgr.dispose();

      const entry = store.entries.get("d1");
      expect(entry).toBeDefined();
      expect(entry!.retryCount).toBeGreaterThanOrEqual(1);
    });

    it("should increment retryCount when get depot returns ok:false", async () => {
      const store = createMemoryQueueStore();
      const storage = createMockStorage();
      const client = createMockClient({
        getFn: async () => ({
          ok: false,
          error: { code: "not_found", message: "Depot not found" },
        }),
      });

      const mgr = createSyncManager({
        storage,
        client,
        queueStore: store,
        debounceMs: DEBOUNCE,
      });

      mgr.enqueue("d1", "rootB", "rootA");
      await wait(DEBOUNCE + 100);
      mgr.dispose();

      const entry = store.entries.get("d1");
      expect(entry).toBeDefined();
      expect(entry!.retryCount).toBeGreaterThanOrEqual(1);
    });
  });

  // --------------------------------------------------------------------------
  // multiple depots in one sync
  // --------------------------------------------------------------------------

  describe("multi-depot sync", () => {
    it("should commit multiple depots in one sync cycle", async () => {
      const store = createMemoryQueueStore();
      const storage = createMockStorage();
      const depots = new Map([
        ["d1", { depotId: "d1", root: "rootA" }],
        ["d2", { depotId: "d2", root: "rootX" }],
      ]);
      const client = createMockClient({ depots });

      const mgr = createSyncManager({
        storage,
        client,
        queueStore: store,
        debounceMs: DEBOUNCE,
      });

      mgr.enqueue("d1", "rootB", "rootA");
      mgr.enqueue("d2", "rootY", "rootX");

      await wait(DEBOUNCE + 100);

      expect(depots.get("d1")!.root).toBe("rootB");
      expect(depots.get("d2")!.root).toBe("rootY");
      expect(store.entries.size).toBe(0);
      // Only one flush call (shared Layer 1)
      expect(storage.flushCount).toBe(1);

      mgr.dispose();
    });
  });
});
