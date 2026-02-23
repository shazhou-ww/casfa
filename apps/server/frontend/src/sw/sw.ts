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
  register(tag: string, options?: { minInterval: number }): Promise<void>;
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

import { type CasfaClient, createClient, type TokenStorageProvider } from "@casfa/client";
import type { ConnectAckMessage } from "@casfa/client-bridge";
import { createIndexedDBTokenStorage, createMessageHandler } from "@casfa/client-sw";
import { createSyncCoordinator } from "@casfa/explorer/core/sync-coordinator";
import { createSyncQueueStore } from "../lib/sync-queue-store.ts";

const BASE_URL = self.location.origin;
const tokenStorage: TokenStorageProvider = createIndexedDBTokenStorage("root");

// ── Broadcast helper ──
function broadcast(msg: unknown): void {
  const bc = new BroadcastChannel("casfa");
  bc.postMessage(msg);
  bc.close();
}

// ── Single client (shared across all connected ports) ──
let client: CasfaClient | null = null;

// ── SyncCoordinator ──
// Storage sync is a no-op in SW — the main thread flushes buffered nodes
// before posting the commit message to the SW.
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
      } else {
        // Create a base client so public endpoints (oauth.getConfig, etc.)
        // work via RPC even before the user is authenticated.
        try {
          client = await createClient({
            baseUrl: BASE_URL,
            realm: "",
            tokenStorage,
            onAuthRequired: () => broadcast({ type: "auth-required" }),
          });
        } catch {
          // Server may be unreachable — client stays null.
          // The connect handler will retry lazily.
        }
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
    })()
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

    // Ensure a client exists (lazy init if SW was restarted after idle-kill)
    const ready = client
      ? Promise.resolve()
      : createClient({
          baseUrl: BASE_URL,
          realm: "",
          tokenStorage,
          onAuthRequired: () => broadcast({ type: "auth-required" }),
        })
          .then((c) => {
            client = c;
          })
          .catch(() => {});

    event.waitUntil(
      ready.then(() => {
        // Send connect-ack with current state
        const ack: ConnectAckMessage = {
          type: "connect-ack",
          authenticated: client !== null && client.getState().user !== null,
          tokenState: client?.getState() ?? null,
          serverInfo: client?.getServerInfo() ?? null,
          syncState: syncCoordinator.getState(),
          pendingCount: syncCoordinator.getPendingCount(),
        };
        port.postMessage(ack);

        // Wire up message handler for this port
        port.onmessage = (e) => handleMessage(e.data, port);
        port.start();
      })
    );
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
// CAS Content Caching — /cas/:key[/~0/~1/...]
//
// Intercepts fetch requests to /cas/ and applies a cache-first strategy.
// CAS content is immutable (content-addressed), so cached entries never need
// invalidation.  The JWT auth token is injected automatically from SW state.
// ============================================================================

const CAS_CACHE_NAME = "casfa-cas-content";

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Only intercept same-origin /cas/ requests
  if (url.origin !== self.location.origin || !url.pathname.startsWith("/cas/")) {
    return; // Let the browser handle it normally
  }

  event.respondWith(handleCasFetch(event.request, url));
});

async function handleCasFetch(request: Request, url: URL): Promise<Response> {
  // Use pathname as cache key (ignores auth headers — CAS content is immutable)
  const cacheKey = new Request(url.pathname, { method: "GET" });

  // 1. Check cache first
  const cache = await caches.open(CAS_CACHE_NAME);
  const cached = await cache.match(cacheKey);
  if (cached) {
    return cached;
  }

  // 2. Get auth token from SW state
  let token: string | undefined;
  try {
    const state = await tokenStorage.load();
    if (state?.user?.accessToken) {
      token = state.user.accessToken;
    }
  } catch {
    // Token unavailable — try without auth (will likely get 401)
  }

  // 3. Fetch from backend with auth
  const headers = new Headers(request.headers);
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const fetchRequest = new Request(request.url, {
    method: "GET",
    headers,
    // Credentials are not needed — we inject the Bearer token ourselves
    credentials: "omit",
  });

  let response: Response;
  try {
    response = await fetch(fetchRequest);
  } catch {
    return new Response(JSON.stringify({ error: "network_error", message: "Failed to fetch CAS content" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }

  // 4. Cache successful responses (clone before consuming)
  if (response.ok) {
    const cloned = response.clone();
    // Write to cache in the background — don't block the response
    cache.put(cacheKey, cloned).catch(() => {});
  }

  return response;
}

// ============================================================================
// Network Recovery
// ============================================================================

self.addEventListener("online", () => {
  // Network restored — immediately attempt to flush pending commits
  syncCoordinator.runSync().catch(() => {});
});
