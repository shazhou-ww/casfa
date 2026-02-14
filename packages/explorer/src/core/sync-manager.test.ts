/**
 * Unit tests for createSyncManager (Layer 2: Depot Commit Sync)
 *
 * Uses in-memory mocks for FlushableStorage, CasfaClient, and SyncQueueStore
 * to verify:
 * - enqueue: basic, merge semantics (targetRoot updated, lastKnownServerRoot stays)
 * - debounce: multiple puts collapse into one sync
 * - sync cycle: flush Layer 1 → get depot → conflict detect → commit → remove
 * - conflict detection: LWW-overwrite + event emission
 * - flush failure: permanent fail (local throw, not retryable)
 * - retry: only network errors (TypeError) retry with exponential backoff
 * - recover: load from store, trigger sync
 * - flushNow: immediate sync (no debounce)
 * - dispose: cancel timers, ignore enqueue
 * - onStateChange / onConflict: listener lifecycle
 */

import { describe, expect, it } from "bun:test";
import type { CasfaClient } from "@casfa/client";
import type {
  ConflictEvent,
  DepotSyncEntry,
  FlushableStorage,
  SyncCommitEvent,
  SyncErrorEvent,
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
}): FlushableStorage & { flushCalls: number } {
  let flushCalls = 0;
  return {
    get flushCalls() {
      return flushCalls;
    },
    async flush() {
      flushCalls++;
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
      const depots = new Map([["d1", { depotId: "d1", root: "nod_rootA" }]]);
      const client = createMockClient({ depots });

      const mgr = createSyncManager({
        storage,
        client,
        queueStore: store,
        debounceMs: DEBOUNCE,
      });

      mgr.enqueue("d1", "nod_rootB", "nod_rootA");

      // Give microtask for async upsert
      await wait(5);

      expect(store.entries.size).toBe(1);
      const entry = store.entries.get("d1")!;
      expect(entry.targetRoot).toBe("nod_rootB");
      expect(entry.lastKnownServerRoot).toBe("nod_rootA");
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

      mgr.enqueue("d1", "nod_rootB", "nod_rootA");
      await wait(5);
      mgr.enqueue("d1", "nod_rootC", "nod_rootB");
      await wait(5);

      expect(store.entries.size).toBe(1);
      const entry = store.entries.get("d1")!;
      // targetRoot should be latest
      expect(entry.targetRoot).toBe("nod_rootC");
      // lastKnownServerRoot should stay from first enqueue
      expect(entry.lastKnownServerRoot).toBe("nod_rootA");

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

      mgr.enqueue("d1", "nod_rootB", "nod_rootA");
      mgr.enqueue("d2", "nod_rootX", "nod_rootW");
      await wait(5);

      expect(store.entries.size).toBe(2);
      expect(store.entries.get("d1")!.targetRoot).toBe("nod_rootB");
      expect(store.entries.get("d2")!.targetRoot).toBe("nod_rootX");

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
      mgr.enqueue("d1", "nod_rootB", "nod_rootA");
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
      const depots = new Map([["d1", { depotId: "d1", root: "nod_rootA" }]]);
      const client = createMockClient({ depots });

      const mgr = createSyncManager({
        storage,
        client,
        queueStore: store,
        debounceMs: DEBOUNCE,
      });

      mgr.enqueue("d1", "nod_rootB", "nod_rootA");

      // Not synced yet
      expect(depots.get("d1")!.root).toBe("nod_rootA");

      // Wait for debounce + buffer
      await wait(DEBOUNCE + 100);

      // Should be committed
      expect(depots.get("d1")!.root).toBe("nod_rootB");
      // Queue should be empty
      expect(store.entries.size).toBe(0);
      expect(mgr.getPendingCount()).toBe(0);

      mgr.dispose();
    });

    it("should merge rapid enqueues into one commit", async () => {
      const store = createMemoryQueueStore();
      const storage = createMockStorage();
      const depots = new Map([["d1", { depotId: "d1", root: "nod_rootA" }]]);
      const commitCalls: string[] = [];
      const client = createMockClient({
        depots,
        commitFn: async (depotId, params) => {
          commitCalls.push(params.root);
          depots.get(depotId)!.root = params.root;
          return {
            ok: true,
            data: { depotId, root: params.root, updatedAt: Date.now() },
            status: 200,
          };
        },
      });

      const mgr = createSyncManager({
        storage,
        client,
        queueStore: store,
        debounceMs: DEBOUNCE,
      });

      mgr.enqueue("d1", "nod_rootB", "nod_rootA");
      mgr.enqueue("d1", "nod_rootC", "nod_rootA");
      mgr.enqueue("d1", "nod_rootD", "nod_rootA");

      await wait(DEBOUNCE + 100);

      // Only one commit with the latest root
      expect(commitCalls).toEqual(["nod_rootD"]);
      expect(depots.get("d1")!.root).toBe("nod_rootD");

      mgr.dispose();
    });

    it("should call storage.flush() before commit", async () => {
      const events: string[] = [];
      const storage: FlushableStorage = {
        async flush() {
          events.push("flush");
        },
      };
      const depots = new Map([["d1", { depotId: "d1", root: "nod_rootA" }]]);
      const client = createMockClient({
        depots,
        commitFn: async (depotId, params) => {
          events.push("commit");
          depots.get(depotId)!.root = params.root;
          return {
            ok: true,
            data: { depotId, root: params.root, updatedAt: Date.now() },
            status: 200,
          };
        },
      });

      const store = createMemoryQueueStore();
      const mgr = createSyncManager({
        storage,
        client,
        queueStore: store,
        debounceMs: DEBOUNCE,
      });

      mgr.enqueue("d1", "nod_rootB", "nod_rootA");
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
      const depots = new Map([["d1", { depotId: "d1", root: "nod_rootA" }]]);
      const client = createMockClient({ depots });
      const states: SyncState[] = [];

      const mgr = createSyncManager({
        storage,
        client,
        queueStore: store,
        debounceMs: DEBOUNCE,
      });

      mgr.onStateChange((s) => states.push(s));
      mgr.enqueue("d1", "nod_rootB", "nod_rootA");

      await wait(DEBOUNCE + 100);

      // idle (initial notification) → syncing → idle
      expect(states).toEqual(["idle", "syncing", "idle"]);

      mgr.dispose();
    });

    it("should notify state=error when flush fails (permanent)", async () => {
      const store = createMemoryQueueStore();
      const storage = createMockStorage({
        flushFn: async () => {
          throw new Error("flush failed");
        },
      });
      const client = createMockClient();
      const states: SyncState[] = [];
      const errors: SyncErrorEvent[] = [];

      const mgr = createSyncManager({
        storage,
        client,
        queueStore: store,
        debounceMs: DEBOUNCE,
      });

      mgr.onStateChange((s) => states.push(s));
      mgr.onError((e) => errors.push(e));
      mgr.enqueue("d1", "nod_rootB", "nod_rootA");

      await wait(DEBOUNCE + 100);

      // flush failure is a local throw → permanent fail, entry removed
      expect(store.entries.has("d1")).toBe(false);
      expect(mgr.getPendingCount()).toBe(0);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.permanent).toBe(true);
      expect(errors[0]!.error.code).toBe("sync_error");

      mgr.dispose();
    });

    it("should unsubscribe onStateChange correctly", async () => {
      const store = createMemoryQueueStore();
      const storage = createMockStorage();
      const depots = new Map([["d1", { depotId: "d1", root: "nod_rootA" }]]);
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

      mgr.enqueue("d1", "nod_rootB", "nod_rootA");
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
      const depots = new Map([["d1", { depotId: "d1", root: "nod_rootX" }]]);
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
      mgr.enqueue("d1", "nod_rootB", "nod_rootA");

      await wait(DEBOUNCE + 100);

      expect(conflicts).toHaveLength(1);
      expect(conflicts[0]!.depotId).toBe("d1");
      expect(conflicts[0]!.localRoot).toBe("nod_rootB");
      expect(conflicts[0]!.serverRoot).toBe("nod_rootX");
      expect(conflicts[0]!.resolution).toBe("lww-overwrite");

      // Should still commit (LWW)
      expect(depots.get("d1")!.root).toBe("nod_rootB");

      mgr.dispose();
    });

    it("should NOT emit conflict when server root matches lastKnownServerRoot", async () => {
      const store = createMemoryQueueStore();
      const storage = createMockStorage();
      const depots = new Map([["d1", { depotId: "d1", root: "nod_rootA" }]]);
      const client = createMockClient({ depots });
      const conflicts: ConflictEvent[] = [];

      const mgr = createSyncManager({
        storage,
        client,
        queueStore: store,
        debounceMs: DEBOUNCE,
      });

      mgr.onConflict((e) => conflicts.push(e));
      mgr.enqueue("d1", "nod_rootB", "nod_rootA");

      await wait(DEBOUNCE + 100);

      expect(conflicts).toHaveLength(0);

      mgr.dispose();
    });

    it("should NOT emit conflict when lastKnownServerRoot is null", async () => {
      const store = createMemoryQueueStore();
      const storage = createMockStorage();
      const depots = new Map([["d1", { depotId: "d1", root: "nod_rootX" }]]);
      const client = createMockClient({ depots });
      const conflicts: ConflictEvent[] = [];

      const mgr = createSyncManager({
        storage,
        client,
        queueStore: store,
        debounceMs: DEBOUNCE,
      });

      mgr.onConflict((e) => conflicts.push(e));
      mgr.enqueue("d1", "nod_rootB", null);

      await wait(DEBOUNCE + 100);

      expect(conflicts).toHaveLength(0);
      // Should still commit
      expect(depots.get("d1")!.root).toBe("nod_rootB");

      mgr.dispose();
    });

    it("should skip commit when server already has targetRoot", async () => {
      const store = createMemoryQueueStore();
      const storage = createMockStorage();
      // Server already has rootB — no need to commit
      const depots = new Map([["d1", { depotId: "d1", root: "nod_rootB" }]]);
      const commitCalls: string[] = [];
      const client = createMockClient({
        depots,
        commitFn: async (_depotId, params) => {
          commitCalls.push(params.root);
          return {
            ok: true,
            data: { depotId: "d1", root: params.root, updatedAt: Date.now() },
            status: 200,
          };
        },
      });

      const mgr = createSyncManager({
        storage,
        client,
        queueStore: store,
        debounceMs: DEBOUNCE,
      });

      mgr.enqueue("d1", "nod_rootB", "nod_rootA");
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
    it("should permanently fail and NOT commit when flush fails", async () => {
      const store = createMemoryQueueStore();
      const storage = createMockStorage({
        flushFn: async () => {
          throw new Error("network error");
        },
      });
      const depots = new Map([["d1", { depotId: "d1", root: "nod_rootA" }]]);
      const commitCalls: string[] = [];
      const errors: SyncErrorEvent[] = [];
      const client = createMockClient({
        depots,
        commitFn: async (_depotId, params) => {
          commitCalls.push(params.root);
          return {
            ok: true,
            data: { depotId: "d1", root: params.root, updatedAt: Date.now() },
            status: 200,
          };
        },
      });

      const mgr = createSyncManager({
        storage,
        client,
        queueStore: store,
        debounceMs: DEBOUNCE,
      });

      mgr.onError((e) => errors.push(e));
      mgr.enqueue("d1", "nod_rootB", "nod_rootA");
      await wait(DEBOUNCE + 100);

      // Should NOT have committed (flush failed)
      expect(commitCalls).toHaveLength(0);
      // Entry should be REMOVED (permanent failure — local throw)
      expect(store.entries.has("d1")).toBe(false);
      expect(mgr.getPendingCount()).toBe(0);
      // Should emit permanent error
      expect(errors).toHaveLength(1);
      expect(errors[0]!.permanent).toBe(true);
      expect(errors[0]!.error.code).toBe("sync_error");

      mgr.dispose();
    });
  });

  // --------------------------------------------------------------------------
  // retry
  // --------------------------------------------------------------------------

  describe("retry", () => {
    it("should increment retryCount on network error (fetch throws)", async () => {
      const store = createMemoryQueueStore();
      const storage = createMockStorage();
      const client = createMockClient({
        commitFn: async () => {
          throw new TypeError("Failed to fetch");
        },
        getFn: async (depotId) => ({
          ok: true,
          data: {
            depotId,
            root: "nod_rootA",
            title: null,
            maxHistory: 10,
            history: [],
            creatorIssuerId: "t",
            createdAt: 0,
            updatedAt: 0,
          },
          status: 200,
        }),
      });

      const mgr = createSyncManager({
        storage,
        client,
        queueStore: store,
        debounceMs: DEBOUNCE,
      });

      mgr.enqueue("d1", "nod_rootB", "nod_rootA");
      await wait(DEBOUNCE + 100);

      // Dispose to stop retries before checking
      mgr.dispose();

      // After at least one failure, retryCount should be >= 1
      const entry = store.entries.get("d1");
      expect(entry).toBeDefined();
      expect(entry!.retryCount).toBeGreaterThanOrEqual(1);
    });

    it("should permanently fail on non-fetch TypeError (e.g. X is not a function)", async () => {
      const store = createMemoryQueueStore();
      const storage = createMockStorage();
      const errors: SyncErrorEvent[] = [];
      const client = createMockClient({
        commitFn: async () => {
          throw new TypeError("client.depots.commit is not a function");
        },
        getFn: async (depotId) => ({
          ok: true,
          data: {
            depotId,
            root: "nod_rootA",
            title: null,
            maxHistory: 10,
            history: [],
            creatorIssuerId: "t",
            createdAt: 0,
            updatedAt: 0,
          },
          status: 200,
        }),
      });

      const mgr = createSyncManager({
        storage,
        client,
        queueStore: store,
        debounceMs: DEBOUNCE,
      });

      mgr.onError((e) => errors.push(e));
      mgr.enqueue("d1", "nod_rootB", "nod_rootA");
      await wait(DEBOUNCE + 100);
      mgr.dispose();

      // Non-fetch TypeError should be permanent, not retryable
      expect(store.entries.has("d1")).toBe(false);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.permanent).toBe(true);
      expect(errors[0]!.error.code).toBe("sync_error");
    });

    it("should permanently fail on 5xx server error (not retryable)", async () => {
      const store = createMemoryQueueStore();
      const storage = createMockStorage();
      const errors: SyncErrorEvent[] = [];
      const client = createMockClient({
        getFn: async (depotId) => ({
          ok: true,
          data: {
            depotId,
            root: "nod_rootA",
            title: null,
            maxHistory: 10,
            history: [],
            creatorIssuerId: "t",
            createdAt: 0,
            updatedAt: 0,
          },
          status: 200,
        }),
        commitFn: async () => ({
          ok: false,
          error: { code: "internal_error", message: "Internal server error", status: 500 },
        }),
      });

      const mgr = createSyncManager({
        storage,
        client,
        queueStore: store,
        debounceMs: DEBOUNCE,
      });

      mgr.onError((e) => errors.push(e));
      mgr.enqueue("d1", "nod_rootB", "nod_rootA");
      await wait(DEBOUNCE + 100);
      mgr.dispose();

      // Should be permanently failed — entry removed
      expect(store.entries.has("d1")).toBe(false);
      expect(mgr.getPendingCount()).toBe(0);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.permanent).toBe(true);
      expect(errors[0]!.error.code).toBe("internal_error");
    });

    it("should permanently fail on 429 rate-limit error (not retryable)", async () => {
      const store = createMemoryQueueStore();
      const storage = createMockStorage();
      const errors: SyncErrorEvent[] = [];
      const client = createMockClient({
        getFn: async () => ({
          ok: false,
          error: { code: "rate_limited", message: "Too many requests", status: 429 },
        }),
      });

      const mgr = createSyncManager({
        storage,
        client,
        queueStore: store,
        debounceMs: DEBOUNCE,
      });

      mgr.onError((e) => errors.push(e));
      mgr.enqueue("d1", "nod_rootB", "nod_rootA");
      await wait(DEBOUNCE + 100);
      mgr.dispose();

      // Should be permanently failed — entry removed
      expect(store.entries.has("d1")).toBe(false);
      expect(mgr.getPendingCount()).toBe(0);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.permanent).toBe(true);
      expect(errors[0]!.error.code).toBe("rate_limited");
    });

    it("should give up after MAX_RETRY_COUNT (10) and remove entry", async () => {
      const store = createMemoryQueueStore();
      // Pre-populate with an entry at max retries
      store.entries.set("d1", {
        depotId: "d1",
        targetRoot: "nod_rootB",
        lastKnownServerRoot: "nod_rootA",
        createdAt: 0,
        updatedAt: 0,
        retryCount: 10,
      });

      const storage = createMockStorage();
      const commitCalls: string[] = [];
      const client = createMockClient({
        getFn: async (depotId) => ({
          ok: true,
          data: {
            depotId,
            root: "nod_rootA",
            title: null,
            maxHistory: 10,
            history: [],
            creatorIssuerId: "t",
            createdAt: 0,
            updatedAt: 0,
          },
          status: 200,
        }),
        commitFn: async (_depotId, params) => {
          commitCalls.push(params.root);
          return {
            ok: true,
            data: { depotId: "d1", root: params.root, updatedAt: Date.now() },
            status: 200,
          };
        },
      });

      const errors: SyncErrorEvent[] = [];
      const mgr = createSyncManager({
        storage,
        client,
        queueStore: store,
        debounceMs: DEBOUNCE,
      });

      mgr.onError((e) => errors.push(e));

      // Recover loads the maxed-out entry
      await mgr.recover();
      await wait(DEBOUNCE + 100);

      // Should NOT attempt commit (exceeded max retries)
      expect(commitCalls).toHaveLength(0);
      // Entry should be REMOVED from queue (not stuck forever)
      expect(store.entries.size).toBe(0);
      expect(mgr.getPendingCount()).toBe(0);
      // Should emit permanent error
      expect(errors).toHaveLength(1);
      expect(errors[0]!.permanent).toBe(true);
      expect(errors[0]!.error.code).toBe("max_retries");

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
        targetRoot: "nod_rootB",
        lastKnownServerRoot: "nod_rootA",
        createdAt: 1000,
        updatedAt: 1000,
        retryCount: 0,
      });

      const storage = createMockStorage();
      const depots = new Map([["d1", { depotId: "d1", root: "nod_rootA" }]]);
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
      expect(depots.get("d1")!.root).toBe("nod_rootB");
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
      const depots = new Map([["d1", { depotId: "d1", root: "nod_rootA" }]]);
      const client = createMockClient({ depots });

      const mgr = createSyncManager({
        storage,
        client,
        queueStore: store,
        debounceMs: 10_000, // very long debounce
      });

      mgr.enqueue("d1", "nod_rootB", "nod_rootA");
      await mgr.flushNow();

      // Should be committed immediately
      expect(depots.get("d1")!.root).toBe("nod_rootB");
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
      expect(storage.flushCalls).toBe(0);

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
      const depots = new Map([["d1", { depotId: "d1", root: "nod_rootA" }]]);
      const commitCalls: string[] = [];
      const client = createMockClient({
        depots,
        commitFn: async (_depotId, params) => {
          commitCalls.push(params.root);
          depots.get("d1")!.root = params.root;
          return {
            ok: true,
            data: { depotId: "d1", root: params.root, updatedAt: Date.now() },
            status: 200,
          };
        },
      });

      const mgr = createSyncManager({
        storage,
        client,
        queueStore: store,
        debounceMs: DEBOUNCE,
      });

      mgr.enqueue("d1", "nod_rootB", "nod_rootA");
      mgr.dispose();

      // Wait past debounce
      await wait(DEBOUNCE + 100);

      // Should NOT have committed (timer was cancelled)
      expect(commitCalls).toHaveLength(0);
      expect(depots.get("d1")!.root).toBe("nod_rootA");
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
      mgr.enqueue("d1", "nod_rootB", "nod_rootA");

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
      const depots = new Map([["d1", { depotId: "d1", root: "nod_rootX" }]]);
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

      mgr.enqueue("d1", "nod_rootB", "nod_rootA");
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
    it("should NOT retry when commit returns ok:false with 4xx (permanent)", async () => {
      const store = createMemoryQueueStore();
      const storage = createMockStorage();
      const errors: SyncErrorEvent[] = [];
      const client = createMockClient({
        getFn: async (depotId) => ({
          ok: true,
          data: {
            depotId,
            root: "nod_rootA",
            title: null,
            maxHistory: 10,
            history: [],
            creatorIssuerId: "t",
            createdAt: 0,
            updatedAt: 0,
          },
          status: 200,
        }),
        commitFn: async () => ({
          ok: false,
          error: { code: "invalid_root", message: "Root hash not found", status: 400 },
        }),
      });

      const mgr = createSyncManager({
        storage,
        client,
        queueStore: store,
        debounceMs: DEBOUNCE,
      });

      mgr.onError((e) => errors.push(e));
      mgr.enqueue("d1", "nod_rootB", "nod_rootA");
      await wait(DEBOUNCE + 100);
      mgr.dispose();

      // Entry should be REMOVED (permanent failure, no retry)
      expect(store.entries.has("d1")).toBe(false);
      expect(mgr.getPendingCount()).toBe(0);
      // Should emit permanent error event
      expect(errors).toHaveLength(1);
      expect(errors[0]!.permanent).toBe(true);
      expect(errors[0]!.error.code).toBe("invalid_root");
    });

    it("should NOT retry when get depot returns ok:false with 4xx (permanent)", async () => {
      const store = createMemoryQueueStore();
      const storage = createMockStorage();
      const errors: SyncErrorEvent[] = [];
      const client = createMockClient({
        getFn: async () => ({
          ok: false,
          error: { code: "not_found", message: "Depot not found", status: 404 },
        }),
      });

      const mgr = createSyncManager({
        storage,
        client,
        queueStore: store,
        debounceMs: DEBOUNCE,
      });

      mgr.onError((e) => errors.push(e));
      mgr.enqueue("d1", "nod_rootB", "nod_rootA");
      await wait(DEBOUNCE + 100);
      mgr.dispose();

      // Entry should be REMOVED (permanent failure, no retry)
      expect(store.entries.has("d1")).toBe(false);
      expect(mgr.getPendingCount()).toBe(0);
      // Should emit permanent error event
      expect(errors).toHaveLength(1);
      expect(errors[0]!.permanent).toBe(true);
      expect(errors[0]!.error.code).toBe("not_found");
    });

    it("should permanently fail when commit returns ok:false with 5xx", async () => {
      const store = createMemoryQueueStore();
      const storage = createMockStorage();
      const errors: SyncErrorEvent[] = [];
      const client = createMockClient({
        getFn: async (depotId) => ({
          ok: true,
          data: {
            depotId,
            root: "nod_rootA",
            title: null,
            maxHistory: 10,
            history: [],
            creatorIssuerId: "t",
            createdAt: 0,
            updatedAt: 0,
          },
          status: 200,
        }),
        commitFn: async () => ({
          ok: false,
          error: { code: "gateway_timeout", message: "Upstream timeout", status: 504 },
        }),
      });

      const mgr = createSyncManager({
        storage,
        client,
        queueStore: store,
        debounceMs: DEBOUNCE,
      });

      mgr.onError((e) => errors.push(e));
      mgr.enqueue("d1", "nod_rootB", "nod_rootA");
      await wait(DEBOUNCE + 100);
      mgr.dispose();

      // Should be permanently failed — entry removed
      expect(store.entries.has("d1")).toBe(false);
      expect(mgr.getPendingCount()).toBe(0);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.permanent).toBe(true);
      expect(errors[0]!.error.code).toBe("gateway_timeout");
    });

    it("should permanently fail when get returns ok:false with no status", async () => {
      const store = createMemoryQueueStore();
      const storage = createMockStorage();
      const errors: SyncErrorEvent[] = [];
      const client = createMockClient({
        getFn: async () => ({
          ok: false,
          error: { code: "unknown", message: "Something went wrong" },
        }),
      });

      const mgr = createSyncManager({
        storage,
        client,
        queueStore: store,
        debounceMs: DEBOUNCE,
      });

      mgr.onError((e) => errors.push(e));
      mgr.enqueue("d1", "nod_rootB", "nod_rootA");
      await wait(DEBOUNCE + 100);
      mgr.dispose();

      // No status → permanent failure (not network error)
      expect(store.entries.has("d1")).toBe(false);
      expect(mgr.getPendingCount()).toBe(0);
      expect(errors).toHaveLength(1);
      expect(errors[0]!.permanent).toBe(true);
      expect(errors[0]!.error.code).toBe("unknown");
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
        ["d1", { depotId: "d1", root: "nod_rootA" }],
        ["d2", { depotId: "d2", root: "nod_rootX" }],
      ]);
      const client = createMockClient({ depots });

      const mgr = createSyncManager({
        storage,
        client,
        queueStore: store,
        debounceMs: DEBOUNCE,
      });

      mgr.enqueue("d1", "nod_rootB", "nod_rootA");
      mgr.enqueue("d2", "nod_rootY", "nod_rootX");

      await wait(DEBOUNCE + 100);

      expect(depots.get("d1")!.root).toBe("nod_rootB");
      expect(depots.get("d2")!.root).toBe("nod_rootY");
      expect(store.entries.size).toBe(0);
      // flush called once per batch
      expect(storage.flushCalls).toBe(2);

      mgr.dispose();
    });
  });

  // --------------------------------------------------------------------------
  // getPendingRoot
  // --------------------------------------------------------------------------

  describe("getPendingRoot", () => {
    it("should return null when no pending entry exists", () => {
      const store = createMemoryQueueStore();
      const storage = createMockStorage();
      const client = createMockClient();

      const mgr = createSyncManager({
        storage,
        client,
        queueStore: store,
        debounceMs: DEBOUNCE,
      });

      expect(mgr.getPendingRoot("d1")).toBeNull();
      mgr.dispose();
    });

    it("should return targetRoot for enqueued depot", async () => {
      const store = createMemoryQueueStore();
      const storage = createMockStorage();
      const client = createMockClient();

      const mgr = createSyncManager({
        storage,
        client,
        queueStore: store,
        debounceMs: DEBOUNCE,
      });

      mgr.enqueue("d1", "nod_rootB", "nod_rootA");
      expect(mgr.getPendingRoot("d1")).toBe("nod_rootB");
      mgr.dispose();
    });

    it("should return latest targetRoot after merge", async () => {
      const store = createMemoryQueueStore();
      const storage = createMockStorage();
      const client = createMockClient();

      const mgr = createSyncManager({
        storage,
        client,
        queueStore: store,
        debounceMs: DEBOUNCE,
      });

      mgr.enqueue("d1", "nod_rootB", "nod_rootA");
      mgr.enqueue("d1", "nod_rootC", "nod_rootB");
      expect(mgr.getPendingRoot("d1")).toBe("nod_rootC");
      mgr.dispose();
    });

    it("should return null after successful sync", async () => {
      const store = createMemoryQueueStore();
      const storage = createMockStorage();
      const depots = new Map([["d1", { depotId: "d1", root: "nod_rootA" }]]);
      const client = createMockClient({ depots });

      const mgr = createSyncManager({
        storage,
        client,
        queueStore: store,
        debounceMs: DEBOUNCE,
      });

      mgr.enqueue("d1", "nod_rootB", "nod_rootA");
      await wait(DEBOUNCE + 100);

      expect(mgr.getPendingRoot("d1")).toBeNull();
      mgr.dispose();
    });

    it("should return targetRoot from recovered entries", async () => {
      const store = createMemoryQueueStore();
      store.entries.set("d1", {
        depotId: "d1",
        targetRoot: "nod_rootB",
        lastKnownServerRoot: "nod_rootA",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        retryCount: 0,
      });
      const storage = createMockStorage();
      // Block the sync so entry stays in queue
      const client = createMockClient({
        getFn: async () => new Promise(() => {}),
      });

      const mgr = createSyncManager({
        storage,
        client,
        queueStore: store,
        debounceMs: DEBOUNCE,
      });

      await mgr.recover();
      // After recover, entry is in memQueue
      expect(mgr.getPendingRoot("d1")).toBe("nod_rootB");
      mgr.dispose();
    });
  });

  // --------------------------------------------------------------------------
  // onCommit
  // --------------------------------------------------------------------------

  describe("onCommit", () => {
    it("should emit commit event on successful commit", async () => {
      const store = createMemoryQueueStore();
      const storage = createMockStorage();
      const depots = new Map([["d1", { depotId: "d1", root: "nod_rootA" }]]);
      const client = createMockClient({ depots });

      const mgr = createSyncManager({
        storage,
        client,
        queueStore: store,
        debounceMs: DEBOUNCE,
      });

      const commits: SyncCommitEvent[] = [];
      mgr.onCommit((event) => {
        commits.push(event);
      });

      mgr.enqueue("d1", "nod_rootB", "nod_rootA");
      await wait(DEBOUNCE + 100);

      expect(commits).toHaveLength(1);
      expect(commits[0]!.depotId).toBe("d1");
      expect(commits[0]!.committedRoot).toBe("nod_rootB");
      mgr.dispose();
    });

    it("should emit commit event when already synced", async () => {
      const store = createMemoryQueueStore();
      const storage = createMockStorage();
      // Server already has rootB
      const depots = new Map([["d1", { depotId: "d1", root: "nod_rootB" }]]);
      const client = createMockClient({ depots });

      const mgr = createSyncManager({
        storage,
        client,
        queueStore: store,
        debounceMs: DEBOUNCE,
      });

      const commits: SyncCommitEvent[] = [];
      mgr.onCommit((event) => {
        commits.push(event);
      });

      mgr.enqueue("d1", "nod_rootB", "nod_rootA");
      await wait(DEBOUNCE + 100);

      expect(commits).toHaveLength(1);
      expect(commits[0]!.depotId).toBe("d1");
      expect(commits[0]!.committedRoot).toBe("nod_rootB");
      mgr.dispose();
    });

    it("should support unsubscribe", async () => {
      const store = createMemoryQueueStore();
      const storage = createMockStorage();
      const depots = new Map([["d1", { depotId: "d1", root: "nod_rootA" }]]);
      const client = createMockClient({ depots });

      const mgr = createSyncManager({
        storage,
        client,
        queueStore: store,
        debounceMs: DEBOUNCE,
      });

      const commits: SyncCommitEvent[] = [];
      const unsub = mgr.onCommit((event) => {
        commits.push(event);
      });

      unsub();

      mgr.enqueue("d1", "nod_rootB", "nod_rootA");
      await wait(DEBOUNCE + 100);

      expect(commits).toHaveLength(0);
      mgr.dispose();
    });

    it("should emit for each depot in multi-depot sync", async () => {
      const store = createMemoryQueueStore();
      const storage = createMockStorage();
      const depots = new Map([
        ["d1", { depotId: "d1", root: "nod_rootA" }],
        ["d2", { depotId: "d2", root: "nod_rootX" }],
      ]);
      const client = createMockClient({ depots });

      const mgr = createSyncManager({
        storage,
        client,
        queueStore: store,
        debounceMs: DEBOUNCE,
      });

      const commits: SyncCommitEvent[] = [];
      mgr.onCommit((event) => {
        commits.push(event);
      });

      mgr.enqueue("d1", "nod_rootB", "nod_rootA");
      mgr.enqueue("d2", "nod_rootY", "nod_rootX");
      await wait(DEBOUNCE + 100);

      expect(commits).toHaveLength(2);
      const depotIds = commits.map((c) => c.depotId).sort();
      expect(depotIds).toEqual(["d1", "d2"]);
      mgr.dispose();
    });
  });
});
