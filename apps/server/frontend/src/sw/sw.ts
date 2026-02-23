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
import {
  type CasContext,
  getNode,
  hashToKey,
  openFileStream,
  type StorageProvider,
} from "@casfa/core";
import { createSyncCoordinator } from "@casfa/explorer/core/sync-coordinator";
import { hashToNodeKey, nodeKeyToStorageKey, storageKeyToNodeKey } from "@casfa/protocol";
import { createSyncQueueStore } from "../lib/sync-queue-store.ts";

console.log("[SW] Script loaded, origin:", self.location.origin);

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
  console.log("[SW] Installing");
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  console.log("[SW] Activating");
  event.waitUntil(
    (async () => {
      await self.clients.claim();
      console.log("[SW] Claimed clients");
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
// CAS Content Serving — /cas/:key[/~0/~1/...]
//
// Intercepts fetch requests to /cas/ and serves content using @casfa/core.
// Supports multi-block files via B-Tree traversal (readFile / openFileStream).
// Uses cache-first strategy — CAS content is immutable (content-addressed).
// ============================================================================

const CAS_CACHE_NAME = "casfa-cas-content";

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Only intercept same-origin /cas/ requests
  if (url.origin !== self.location.origin || !url.pathname.startsWith("/cas/")) {
    return; // Let the browser handle it normally
  }

  console.log("[SW] Intercepted /cas/ fetch:", url.pathname);
  event.respondWith(handleCasFetch(event.request, url));
});

/**
 * Create a read-only CasContext backed by the CasfaClient's nodes API.
 * Includes a per-request in-memory cache so nodes fetched during B-Tree
 * traversal are not re-fetched.
 */
function createReadonlyContext(cl: CasfaClient): CasContext {
  const cache = new Map<string, Uint8Array>();

  const storage: StorageProvider = {
    get: async (storageKey: string) => {
      const cached = cache.get(storageKey);
      if (cached) return cached;

      const nodeKey = storageKeyToNodeKey(storageKey);
      const result = await cl.nodes.get(nodeKey);
      if (!result.ok) return null;

      cache.set(storageKey, result.data);
      return result.data;
    },
    put: async () => {
      // Read-only — no-op
    },
  };

  // KeyProvider is only needed for writes; provide a stub
  const key = {
    computeKey: async (_data: Uint8Array) => new Uint8Array(16),
  };

  return { storage, key };
}

/**
 * Navigate ~N index path through dict/file nodes.
 * Returns the final node's storage key, or null on failure.
 */
async function navigatePath(
  ctx: CasContext,
  startStorageKey: string,
  segments: string[]
): Promise<{ storageKey: string } | { error: string; status: number }> {
  let currentKey = startStorageKey;

  for (const seg of segments) {
    if (!/^~\d+$/.test(seg)) {
      return { error: `Invalid navigation segment: ${seg}`, status: 400 };
    }
    const index = Number.parseInt(seg.slice(1), 10);

    const node = await getNode(ctx, currentKey);
    if (!node) {
      return { error: "Node not found during navigation", status: 404 };
    }

    if (!node.children || index >= node.children.length) {
      return {
        error: `Child index ${index} out of bounds (${node.children?.length ?? 0} children)`,
        status: 404,
      };
    }

    currentKey = hashToKey(node.children[index]!);
  }

  return { storageKey: currentKey };
}

async function handleCasFetch(request: Request, url: URL): Promise<Response> {
  console.log("[SW] handleCasFetch:", url.pathname, "client:", !!client);

  // Use pathname as cache key (ignores auth headers — CAS content is immutable)
  const cacheKey = new Request(url.pathname, { method: "GET" });

  // 1. Check cache first
  const cache = await caches.open(CAS_CACHE_NAME);
  const cached = await cache.match(cacheKey);
  if (cached) {
    console.log("[SW] Cache hit:", url.pathname);
    return cached;
  }

  // 2. Ensure client is available
  if (!client) {
    console.warn("[SW] No client — returning 401");
    return new Response(
      JSON.stringify({ error: "not_authenticated", message: "Service Worker not authenticated" }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }

  // 3. Parse nodeKey and optional navigation path from URL
  //    /cas/nod_XXX          → serve node directly
  //    /cas/nod_XXX/~0/~1    → navigate then serve
  const pathAfterCas = url.pathname.slice("/cas/".length);
  const parts = pathAfterCas.split("/");
  const nodeKey = decodeURIComponent(parts[0] ?? "");
  const navSegments = parts.slice(1).filter(Boolean);

  if (!nodeKey) {
    return new Response(JSON.stringify({ error: "invalid_request", message: "Missing node key" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const ctx = createReadonlyContext(client);
    let targetStorageKey = nodeKeyToStorageKey(nodeKey);

    // 4. Navigate path if ~N segments are present
    if (navSegments.length > 0) {
      const nav = await navigatePath(ctx, targetStorageKey, navSegments);
      if ("error" in nav) {
        return new Response(JSON.stringify({ error: "navigation_failed", message: nav.error }), {
          status: nav.status,
          headers: { "Content-Type": "application/json" },
        });
      }
      targetStorageKey = nav.storageKey;
    }

    // 5. Decode root node to determine type and content-type
    const node = await getNode(ctx, targetStorageKey);
    console.log("[SW] getNode result:", targetStorageKey, node ? node.kind : "null");
    if (!node) {
      return new Response(JSON.stringify({ error: "not_found", message: "Node not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    const immutableCache = "public, max-age=31536000, immutable";
    const targetNodeKey = storageKeyToNodeKey(targetStorageKey);

    switch (node.kind) {
      case "dict": {
        // Serve dict as JSON mapping childName → nodeKey
        const children: Record<string, string> = {};
        if (node.children && node.childNames) {
          for (let i = 0; i < node.childNames.length; i++) {
            const name = node.childNames[i];
            const childHash = node.children[i];
            if (name && childHash) {
              children[name] = hashToNodeKey(childHash);
            }
          }
        }
        const body = JSON.stringify({ type: "dict", key: targetNodeKey, children });
        const response = new Response(body, {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": immutableCache,
            "X-CAS-Key": targetNodeKey,
          },
        });
        cache.put(cacheKey, response.clone()).catch(() => {});
        return response;
      }

      case "file": {
        const contentType = node.fileInfo?.contentType || "application/octet-stream";

        // Use streaming for multi-block files (B-Tree traversal)
        const stream = openFileStream(ctx, targetStorageKey);
        const response = new Response(stream, {
          status: 200,
          headers: {
            "Content-Type": contentType,
            "Cache-Control": immutableCache,
            "X-CAS-Key": targetNodeKey,
          },
        });

        // Cache the response (must tee for caching while returning)
        // For simplicity, we don't cache streamed responses inline —
        // instead, re-fetch from the in-memory ctx cache would be instant.
        // We DO cache the final response so subsequent requests hit the SW cache.
        cache.put(cacheKey, response.clone()).catch(() => {});
        return response;
      }

      case "successor":
        return new Response(
          JSON.stringify({
            error: "unsupported_node_type",
            message: "Successor nodes cannot be served directly",
          }),
          { status: 422, headers: { "Content-Type": "application/json" } }
        );

      case "set":
        return new Response(
          JSON.stringify({
            error: "unsupported_node_type",
            message: "Set nodes cannot be served directly",
          }),
          { status: 422, headers: { "Content-Type": "application/json" } }
        );

      default:
        return new Response(
          JSON.stringify({ error: "invalid_node", message: "Unknown node kind" }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
    }
  } catch (err) {
    console.error("[SW] handleCasFetch error:", err);
    return new Response(
      JSON.stringify({
        error: "internal_error",
        message: err instanceof Error ? err.message : "Failed to serve CAS content",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

// ============================================================================
// Network Recovery
// ============================================================================

self.addEventListener("online", () => {
  // Network restored — immediately attempt to flush pending commits
  syncCoordinator.runSync().catch(() => {});
});
