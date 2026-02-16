/**
 * Direct mode — CasfaClient + SyncManager running in main thread.
 *
 * Returns an AppClient whose CasfaClient methods delegate to a mutable
 * internal `client` instance. `setUserToken()` re-creates the client
 * with the correct realm and initialises the SyncManager.
 *
 * This is the Phase 1 / fallback implementation — no Service Worker.
 */

import { createClient } from "@casfa/client";
import { createMergeHandler } from "@casfa/explorer/core/merge-handler";
import {
  createSyncManager,
  type MergeHandler,
  type SyncManager,
} from "@casfa/explorer/core/sync-manager";
import type { AppClient, AppClientConfig } from "./types.ts";

export async function createDirectClient(config: AppClientConfig): Promise<AppClient> {
  // ── Create initial CasfaClient ──
  let client = await createClient({
    baseUrl: config.baseUrl,
    realm: config.realm,
    tokenStorage: config.tokenStorage,
    onAuthRequired: config.onAuthRequired,
  });

  // Auto-recover realm from persisted tokens (same pattern as current frontend)
  const initialState = client.getState();
  if (!config.realm && initialState.user?.userId) {
    client = await createClient({
      baseUrl: config.baseUrl,
      realm: initialState.user.userId,
      tokenStorage: config.tokenStorage,
      onAuthRequired: config.onAuthRequired,
    });
  }

  // ── SyncManager (created after setUserToken or on auto-recover) ──
  let syncManager: SyncManager | null = null;

  function notifyPendingCount(): void {
    const count = syncManager?.getPendingCount() ?? 0;
    syncListeners.pendingCount.forEach((fn) => {
      fn(count);
    });
  }

  function initSyncManager(): void {
    if (syncManager) {
      syncManager.dispose();
    }
    if (!config.storage || !config.queueStore) return;

    // Build merge handler (lazy StorageProvider resolution to avoid circular init)
    let mergeHandler: MergeHandler | undefined;
    if (config.getLocalStorage && config.keyProvider) {
      const getStorage = config.getLocalStorage;
      const kp = config.keyProvider;
      let inner: MergeHandler | null = null;

      mergeHandler = async (args) => {
        if (!inner) {
          const storage = await getStorage();
          inner = createMergeHandler({ storage, keyProvider: kp, client });
        }
        return inner(args);
      };
    }

    syncManager = createSyncManager({
      storage: config.storage,
      client,
      queueStore: config.queueStore,
      debounceMs: config.syncDebounceMs ?? 2_000,
      mergeHandler,
    });
    // Wire events → AppClient listeners
    syncManager.onStateChange((s) =>
      syncListeners.syncState.forEach((fn) => {
        fn(s);
      })
    );
    syncManager.onConflict((e) =>
      syncListeners.conflict.forEach((fn) => {
        fn(e);
      })
    );
    syncManager.onError((e) =>
      syncListeners.syncError.forEach((fn) => {
        fn(e);
      })
    );
    syncManager.onCommit((e) =>
      syncListeners.commit.forEach((fn) => {
        fn(e);
      })
    );
    // Fire pending count after each state change (enqueue/commit/recover)
    syncManager.onStateChange(() => notifyPendingCount());
    syncManager.onCommit(() => notifyPendingCount());
  }

  // ── Event listeners ──
  const syncListeners = {
    syncState: new Set<(s: import("./types.ts").SyncState) => void>(),
    conflict: new Set<(e: import("./types.ts").ConflictEvent) => void>(),
    syncError: new Set<(e: import("./types.ts").SyncErrorEvent) => void>(),
    commit: new Set<(e: import("./types.ts").SyncCommitEvent) => void>(),
    pendingCount: new Set<(n: number) => void>(),
  };

  // Auto-init SyncManager if we already have auth + storage
  if (client.getState().user && config.storage && config.queueStore) {
    initSyncManager();
    await syncManager!.recover();
  }

  // ── AppClient ──
  return {
    // ── CasfaClient delegation (always routes to current `client`) ──
    get oauth() {
      return client.oauth;
    },
    get tokens() {
      return client.tokens;
    },
    get delegates() {
      return client.delegates;
    },
    get depots() {
      return client.depots;
    },
    get fs() {
      return client.fs;
    },
    get nodes() {
      return client.nodes;
    },
    getState() {
      return client.getState();
    },
    getServerInfo() {
      return client.getServerInfo();
    },
    setRootDelegate(delegate) {
      client.setRootDelegate(delegate);
    },
    getAccessToken() {
      return client.getAccessToken();
    },

    // ── AppClient: auth ──
    async setUserToken(userId: string) {
      client = await createClient({
        baseUrl: config.baseUrl,
        realm: userId,
        tokenStorage: config.tokenStorage,
        onAuthRequired: config.onAuthRequired,
      });
      initSyncManager();
      if (syncManager) {
        await syncManager.recover();
      }
    },

    // ── AppClient: sync ──
    scheduleCommit(depotId, newRoot, lastKnownServerRoot) {
      if (!syncManager) {
        throw new Error(
          "SyncManager not initialized — call setUserToken first or provide storage + queueStore"
        );
      }
      syncManager.enqueue(depotId, newRoot, lastKnownServerRoot);
      notifyPendingCount();
    },

    async getPendingRoot(depotId) {
      return syncManager?.getPendingRoot(depotId) ?? null;
    },

    async flushNow() {
      if (!syncManager) return;
      await syncManager.flushNow();
    },

    // ── AppClient: events ──
    onSyncStateChange(fn) {
      syncListeners.syncState.add(fn);
      return () => {
        syncListeners.syncState.delete(fn);
      };
    },
    onConflict(fn) {
      syncListeners.conflict.add(fn);
      return () => {
        syncListeners.conflict.delete(fn);
      };
    },
    onSyncError(fn) {
      syncListeners.syncError.add(fn);
      return () => {
        syncListeners.syncError.delete(fn);
      };
    },
    onCommit(fn) {
      syncListeners.commit.add(fn);
      return () => {
        syncListeners.commit.delete(fn);
      };
    },
    onPendingCountChange(fn) {
      syncListeners.pendingCount.add(fn);
      return () => {
        syncListeners.pendingCount.delete(fn);
      };
    },

    // ── AppClient: lifecycle ──
    async logout() {
      if (syncManager) {
        await syncManager.flushNow();
        syncManager.dispose();
        syncManager = null;
      }
      client.logout();
    },

    dispose() {
      if (syncManager) {
        syncManager.dispose();
        syncManager = null;
      }
      syncListeners.syncState.clear();
      syncListeners.conflict.clear();
      syncListeners.syncError.clear();
      syncListeners.commit.clear();
      syncListeners.pendingCount.clear();
    },
  };
}
