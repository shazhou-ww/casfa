/// <reference lib="webworker" />
declare const self: ServiceWorkerGlobalScope;

// Background Sync API types (not yet in TS's WebWorker lib)
interface SyncEvent extends ExtendableEvent {
  readonly tag: string;
  readonly lastChance: boolean;
}
interface SyncManager {
  register(tag: string): Promise<void>;
  getTags(): Promise<string[]>;
}

// Periodic Background Sync API types
interface PeriodicSyncEvent extends ExtendableEvent {
  readonly tag: string;
}
interface PeriodicSyncManager {
  register(
    tag: string,
    options?: { minInterval: number },
  ): Promise<void>;
  unregister(tag: string): Promise<void>;
  getTags(): Promise<string[]>;
}

declare global {
  interface ServiceWorkerRegistration {
    readonly sync: SyncManager;
    readonly periodicSync?: PeriodicSyncManager;
  }
  interface ServiceWorkerGlobalScopeEventMap {
    sync: SyncEvent;
    periodicsync: PeriodicSyncEvent;
  }
}

/**
 * CASFA Service Worker — thin shell
 *
 * Delegates all message handling to @casfa/client-sw.
 * Holds a single CasfaClient instance shared across all connected tabs.
 * SyncCoordinator manages Layer 2 depot commits + Background Sync.
 */

import {
  createClient,
  type CasfaClient,
  type TokenStorageProvider,
} from "@casfa/client";
import {
  createMessageHandler,
  createIndexedDBTokenStorage,
} from "@casfa/client-sw";
import type { ConnectAckMessage } from "@casfa/client-bridge";
import { createSyncCoordinator } from "@casfa/explorer/core/sync-coordinator";
import { createSyncQueueStore } from "../lib/sync-queue-store.ts";

const BASE_URL = self.location.origin;
const tokenStorage: TokenStorageProvider =
  createIndexedDBTokenStorage("root");

// ── Broadcast helper ──
function broadcast(msg: unknown): void {
  const bc = new BroadcastChannel("casfa");
  bc.postMessage(msg);
  bc.close();
}

// ── Single client (shared across all connected ports) ──
let client: CasfaClient | null = null;

// ── SyncCoordinator ──
// Storage flush is a no-op in SW — the main thread owns CachedStorage.
// Layer 1 flush is triggered by the main thread before scheduleCommit.
const noopFlushStorage = { flush: async () => {} };

const syncCoordinator = createSyncCoordinator({
  storage: noopFlushStorage,
  queueStore: createSyncQueueStore(),
  broadcast,
  debounceMs: 2_000,
});

// ── Message handler ──
const handleMessage = createMessageHandler({
  getClient: () => {
    if (!client) throw new Error("Not authenticated");
    return client;
  },
  setClient: (c: CasfaClient) => {
    client = c;
  },
  baseUrl: BASE_URL,
  tokenStorage,
  broadcast,
  syncCoordinator,
});

// ============================================================================
// Lifecycle
// ============================================================================

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      await self.clients.claim();
      // Try to recover client from persisted tokens
      const recovered = await recoverClient();
      if (recovered) {
        client = recovered;
        syncCoordinator.setClient(recovered);
        await syncCoordinator.recover();
      }
      // Register Periodic Background Sync (progressive enhancement)
      if (self.registration.periodicSync) {
        try {
          await self.registration.periodicSync.register("casfa-periodic-sync", {
            minInterval: 60 * 60 * 1000, // 1 hour
          });
        } catch {
          // Permission denied or API not available — ignore
        }
      }
    })(),
  );
});

/**
 * Recover CasfaClient from IndexedDB token persistence.
 * Returns null if no valid tokens are found.
 */
async function recoverClient(): Promise<CasfaClient | null> {
  try {
    const state = await tokenStorage.load();
    if (!state?.user?.userId) return null;
    return createClient({
      baseUrl: BASE_URL,
      realm: state.user.userId,
      tokenStorage,
      onAuthRequired: () => broadcast({ type: "auth-required" }),
    });
  } catch {
    return null;
  }
}

// ============================================================================
// Connection handling
// ============================================================================

self.addEventListener("message", (event) => {
  if (event.data?.type === "connect") {
    const port = event.ports[0];
    if (!port) return;

    // Send connect-ack with current state
    const ack: ConnectAckMessage = {
      type: "connect-ack",
      authenticated: client !== null,
      tokenState: client?.getState() ?? null,
      serverInfo: client?.getServerInfo() ?? null,
      syncState: syncCoordinator.getState(),
      pendingCount: syncCoordinator.getPendingCount(),
    };
    port.postMessage(ack);

    // Wire up message handler for this port
    port.onmessage = (e) => handleMessage(e.data, port);
    port.start();
  }
});

// ============================================================================
// Background Sync
// ============================================================================

self.addEventListener("sync", (event) => {
  if (event.tag === "casfa-sync") {
    event.waitUntil(syncCoordinator.runSync());
  }
});

// ============================================================================
// Periodic Background Sync
// ============================================================================

self.addEventListener("periodicsync", (event) => {
  if (event.tag === "casfa-periodic-sync") {
    event.waitUntil(syncCoordinator.runSync());
  }
});

// ============================================================================
// Network Recovery
// ============================================================================

self.addEventListener("online", () => {
  // Network restored — immediately attempt to flush pending commits
  syncCoordinator.runSync().catch(() => {});
});
