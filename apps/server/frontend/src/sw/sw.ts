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
import type { SwApi, SwInitState, FireAndForgetMessage } from "@casfa/client-bridge";
import { createIndexedDBTokenStorage } from "@casfa/client-sw";
import * as Comlink from "comlink";
import {
  type CasContext,
  encodeDictNode,
  getNode,
  hashToKey,
  isWellKnownNode,
  getWellKnownNodeData,
  keyToHash,
  openFileStream,
  type StorageProvider,
} from "@casfa/core";
import { createSyncCoordinator } from "@casfa/explorer/core/sync-coordinator";
import { hashToNodeKey, nodeKeyToStorageKey, storageKeyToNodeKey } from "@casfa/protocol";
import { createIndexedDBStorage } from "@casfa/storage-indexeddb";
import { createSyncQueueStore } from "../lib/sync-queue-store.ts";
import { getKeyProvider } from "../lib/storage.ts";
import { initBuiltinViewers } from "./builtin-viewers.ts";
import { createViewerService, type ViewerService } from "./viewer-service.ts";

console.log("[SW] Script loaded, origin:", self.location.origin);

const BASE_URL = self.location.origin;
const tokenStorage: TokenStorageProvider = createIndexedDBTokenStorage("root");

// ── Shared IndexedDB storage — same DB as the main thread ──
// Reads from IndexedDB first so freshly-uploaded (but not yet synced) nodes
// are available immediately in the SW fetch handler.
const idbStorage = createIndexedDBStorage();

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
const noopFlushStorage = { flush: async () => { } };

const syncCoordinator = createSyncCoordinator({
  storage: noopFlushStorage,
  queueStore: createSyncQueueStore(),
  broadcast,
  debounceMs: 2_000,
});

// ── Viewer service (lazy init — uses keyProvider + virtualNodes) ──
let viewerService: ViewerService | null = null;

function getViewerService(): ViewerService {
  if (!viewerService) {
    viewerService = createViewerService(getKeyProvider(), virtualNodes);
  }
  return viewerService;
}

/**
 * Create the Comlink-exposed SwApi object.
 *
 * This is created per-port connection and wraps the shared client + services.
 */
function createSwApi(): SwApi {
  const getClient = () => {
    if (!client) throw new Error("Not authenticated");
    return client;
  };

  return {
    // ── Namespaces (proxy to CasfaClient) ──
    get oauth() {
      return getClient().oauth;
    },
    get tokens() {
      return getClient().tokens;
    },
    get delegates() {
      return getClient().delegates;
    },
    get depots() {
      return getClient().depots;
    },
    get fs() {
      return getClient().fs;
    },
    get nodes() {
      return getClient().nodes;
    },
    get viewers() {
      return getViewerService();
    },

    // ── Top-level CasfaClient methods ──
    getState() {
      return client?.getState() ?? { user: null, rootDelegate: null };
    },
    getServerInfo() {
      return client?.getServerInfo() ?? null;
    },
    setRootDelegate(delegate) {
      client?.setRootDelegate(delegate);
    },
    async getAccessToken() {
      return (await client?.getAccessToken()) ?? null;
    },

    // ── Auth lifecycle ──
    async setUserToken(userId: string) {
      const newClient = await createClient({
        baseUrl: BASE_URL,
        realm: userId,
        tokenStorage,
        onAuthRequired: () => broadcast({ type: "auth-required" }),
      });
      client = newClient;
      clientInitPromise = null;
      syncCoordinator.setClient(newClient);
      // Broadcast updated state to all tabs
      broadcast({
        type: "token-state-changed",
        payload: newClient.getState(),
      });
    },
    async logout() {
      await syncCoordinator.flushNow();
      client?.logout();
    },

    // ── Sync operations ──
    getPendingRoot(depotId: string) {
      return syncCoordinator.getPendingRoot(depotId);
    },
    async flushNow() {
      await syncCoordinator.flushNow();
    },

    // ── Initial state (returned after Comlink connect) ──
    getInitialState(): SwInitState {
      return {
        authenticated: client !== null && client.getState().user !== null,
        tokenState: client?.getState() ?? null,
        serverInfo: client?.getServerInfo() ?? null,
        syncState: syncCoordinator.getState(),
        pendingCount: syncCoordinator.getPendingCount(),
      };
    },
  };
}

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
      // Initialize client (shared with connect/fetch handlers)
      await ensureClient();
      // If recovery succeeded, restore pending sync queue
      if (client?.getState().user) {
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

/**
 * Ensure a CasfaClient is available.
 *
 * Uses a cached promise so concurrent calls (activate + connect + fetch)
 * share a single initialization and never race against each other.
 *
 * After SW idle-kill and restart, `activate` does not re-fire, so `client`
 * is null. This helper first tries to recover a fully-authenticated client
 * from persisted tokens (which carries the correct realm), and only falls
 * back to a base client with `realm: ""` if no stored user is found.
 */
let clientInitPromise: Promise<void> | null = null;

function ensureClient(): Promise<void> {
  if (client) return Promise.resolve();
  if (!clientInitPromise) {
    clientInitPromise = (async () => {
      // Try recovery first so realm is set correctly
      const recovered = await recoverClient();
      if (recovered) {
        client = recovered;
        syncCoordinator.setClient(recovered);
        return;
      }

      // No stored user — create a base client for public endpoints
      try {
        client = await createClient({
          baseUrl: BASE_URL,
          realm: "",
          tokenStorage,
          onAuthRequired: () => broadcast({ type: "auth-required" }),
        });
      } catch {
        // Server unreachable — client stays null
      }
    })();
  }
  return clientInitPromise;
}

// ============================================================================
// Connection handling — Comlink-based
// ============================================================================

self.addEventListener("message", (event) => {
  const msg = event.data as FireAndForgetMessage | undefined;

  // ── Comlink initialization ──
  if (msg?.type === "comlinkInit") {
    const port = event.data.port as MessagePort | undefined;
    if (!port) {
      console.error("[SW] comlinkInit received without port!");
      return;
    }

    // Ensure a client exists (lazy init if SW was restarted after idle-kill)
    event.waitUntil(
      ensureClient().then(() => {
        // Expose the API via Comlink
        const api = createSwApi();
        Comlink.expose(api, port);
        console.log("[SW] Comlink API exposed on port");
      })
    );
    return;
  }

  // ── Fire-and-forget: schedule-commit ──
  if (msg?.type === "schedule-commit") {
    syncCoordinator.enqueue(msg.depotId, msg.targetRoot, msg.lastKnownServerRoot);
    return;
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

// ============================================================================
// Virtual Node Overlay — in-memory cache for composed d-nodes
//
// Stores ephemeral d-nodes created by /view composition. These nodes are
// never persisted to IndexedDB or the server — they only live in SW memory.
// Uses a simple LRU eviction with a fixed max size.
// ============================================================================

const VIRTUAL_NODE_MAX = 100;
const virtualNodes = new Map<string, Uint8Array>();

function putVirtualNode(storageKey: string, bytes: Uint8Array): void {
  // LRU eviction: remove oldest entry if at capacity
  if (virtualNodes.size >= VIRTUAL_NODE_MAX && !virtualNodes.has(storageKey)) {
    const oldest = virtualNodes.keys().next().value;
    if (oldest) virtualNodes.delete(oldest);
  }
  virtualNodes.set(storageKey, bytes);
}

/** Set of virtual root storage keys — used to detect /page/ requests for composed roots */
const virtualRoots = new Set<string>();

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  // Route: /view?target=...&viewer=...
  if (url.pathname === "/view") {
    console.log("[SW] Intercepted /view:", url.search);
    event.respondWith(ensureClient().then(() => handleViewCompose(url)));
    return;
  }

  // Route: /view/builtins — list available built-in viewers
  if (url.pathname === "/view/builtins") {
    event.respondWith(handleBuiltinViewersList());
    return;
  }

  // Route: /page/:key[/path/to/file]
  if (url.pathname.startsWith("/page/")) {
    console.log("[SW] Intercepted /page/:", url.pathname);
    event.respondWith(ensureClient().then(() => handlePageFetch(event.request, url)));
    return;
  }

  // Route: /cas/:key[/~0/~1/...]
  if (url.pathname.startsWith("/cas/")) {
    console.log("[SW] Intercepted /cas/ fetch:", url.pathname);
    event.respondWith(ensureClient().then(() => handleCasFetch(event.request, url)));
    return;
  }

  // Let the browser handle all other requests normally
});

/**
 * Create a read-only CasContext backed by IndexedDB (local cache) + CasfaClient API (remote).
 *
 * Reads from IndexedDB first — this is the same database the main thread writes to
 * when uploading files (via CachedStorage). This ensures freshly-uploaded nodes that
 * haven't been synced to the server yet are still available for immediate serving.
 *
 * Falls back to the server API on IndexedDB miss, and writes the result back to
 * IndexedDB for future reads.
 *
 * Also includes a per-request in-memory cache so nodes fetched during B-Tree
 * traversal are not re-fetched.
 */
function createReadonlyContext(cl: CasfaClient): CasContext {
  const memCache = new Map<string, Uint8Array>();

  const storage: StorageProvider = {
    get: async (storageKey: string) => {
      // 1. In-memory per-request cache
      const mem = memCache.get(storageKey);
      if (mem) return mem;

      // 2. IndexedDB (shared with main thread — has freshly-uploaded nodes)
      const idbData = await idbStorage.get(storageKey);
      if (idbData) {
        memCache.set(storageKey, idbData);
        return idbData;
      }

      // 3. Remote server API (fallback)
      const nodeKey = storageKeyToNodeKey(storageKey);
      const result = await cl.nodes.get(nodeKey);
      if (!result.ok) return null;

      memCache.set(storageKey, result.data);
      // Write-back to IndexedDB for future reads
      idbStorage.put(storageKey, result.data).catch(() => { });
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
 * Navigate path through dict/file nodes.
 * Supports both ~N index segments and name-based segments (for d-nodes).
 * Returns the final node's storage key, or an error.
 */
async function navigatePath(
  ctx: CasContext,
  startStorageKey: string,
  segments: string[]
): Promise<{ storageKey: string } | { error: string; status: number }> {
  let currentKey = startStorageKey;

  for (const seg of segments) {
    const node = await getNode(ctx, currentKey);
    if (!node) {
      return { error: "Node not found during navigation", status: 404 };
    }

    if (/^~\d+$/.test(seg)) {
      // Index-based navigation: ~N
      const index = Number.parseInt(seg.slice(1), 10);
      if (!node.children || index >= node.children.length) {
        return {
          error: `Child index ${index} out of bounds (${node.children?.length ?? 0} children)`,
          status: 404,
        };
      }
      currentKey = hashToKey(node.children[index]!);
    } else {
      // Name-based navigation: requires a dict node
      if (node.kind !== "dict" || !node.childNames || !node.children) {
        return { error: `Cannot navigate by name into a ${node.kind} node`, status: 400 };
      }
      const idx = node.childNames.indexOf(seg);
      if (idx < 0) {
        return { error: `Child "${seg}" not found in dict node`, status: 404 };
      }
      currentKey = hashToKey(node.children[idx]!);
    }
  }

  return { storageKey: currentKey };
}

// ============================================================================
// Page Serving — /page/:key[/path/...]
//
// Serves CAS content with name-based path navigation. Used by the /view
// composition system. Supports virtual nodes from the overlay cache.
//
// Special behavior for virtual roots:
//   /page/{virtualRoot}/index.html → returns bootstrap HTML (hardcoded)
//   /page/{virtualRoot}/{path}      → normal name navigation
// ============================================================================

/** Bootstrap HTML served for index.html at virtual composed roots.
 *
 * Loads manifest.json first to discover the entry script path (default: index.js).
 * Exposes the parsed manifest as `window.__CASFA_VIEWER_MANIFEST` so the entry
 * script can read viewer metadata without a second fetch.
 */
const BOOTSTRAP_HTML = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body><script type="module">
(async()=>{
  try{
    const r=await fetch('manifest.json');
    if(!r.ok)throw new Error('manifest.json not found');
    const m=await r.json();
    window.__CASFA_VIEWER_MANIFEST=m;
    const entry=m.entry||'index.js';
    const s=document.createElement('script');
    s.type='module';s.src=entry;
    document.head.appendChild(s);
  }catch(e){
    document.body.innerHTML='<p style="color:red;font-family:system-ui;">Failed to load viewer: '+e.message+'</p>';
  }
})();
</script></body></html>`;

/**
 * Create a CasContext that reads from virtualNodes overlay + IDB + remote.
 * Writes go to the virtual overlay (for composed d-nodes).
 */
function createPageContext(cl: CasfaClient): CasContext {
  const memCache = new Map<string, Uint8Array>();

  const storage: StorageProvider = {
    get: async (storageKey: string) => {
      // 0. In-memory per-request cache
      const mem = memCache.get(storageKey);
      if (mem) return mem;

      // 1. Virtual node overlay (composed d-nodes)
      const virt = virtualNodes.get(storageKey);
      if (virt) {
        memCache.set(storageKey, virt);
        return virt;
      }

      // 2. Well-known nodes
      if (isWellKnownNode(storageKey)) {
        const data = getWellKnownNodeData(storageKey);
        if (data) {
          memCache.set(storageKey, data);
          return data;
        }
      }

      // 3. IndexedDB (shared with main thread)
      const idbData = await idbStorage.get(storageKey);
      if (idbData) {
        memCache.set(storageKey, idbData);
        return idbData;
      }

      // 4. Remote server API (fallback)
      const nodeKey = storageKeyToNodeKey(storageKey);
      const result = await cl.nodes.get(nodeKey);
      if (!result.ok) return null;

      memCache.set(storageKey, result.data);
      idbStorage.put(storageKey, result.data).catch(() => { });
      return result.data;
    },
    put: async () => {
      // No-op for page context
    },
  };

  return { storage, key: getKeyProvider() };
}

async function handlePageFetch(_request: Request, url: URL): Promise<Response> {
  if (!client) {
    return new Response(
      JSON.stringify({ error: "not_authenticated", message: "Service Worker not authenticated" }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }

  // Parse: /page/nod_XXX[/path/to/file]
  const pathAfterPage = url.pathname.slice("/page/".length);
  const parts = pathAfterPage.split("/");
  const nodeKey = decodeURIComponent(parts[0] ?? "");
  const navSegments = parts.slice(1).filter(Boolean).map(decodeURIComponent);

  if (!nodeKey) {
    return new Response(JSON.stringify({ error: "invalid_request", message: "Missing node key" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const rootStorageKey = nodeKeyToStorageKey(nodeKey);
    const isVirtual = virtualRoots.has(rootStorageKey);

    // Virtual root + index.html → return bootstrap HTML
    if (isVirtual && navSegments.length === 1 && navSegments[0] === "index.html") {
      return new Response(BOOTSTRAP_HTML, {
        status: 200,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-cache",
        },
      });
    }

    const ctx = createPageContext(client);
    let targetStorageKey = rootStorageKey;

    // Navigate name-based path segments
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

    // Decode target node
    const node = await getNode(ctx, targetStorageKey);
    if (!node) {
      return new Response(JSON.stringify({ error: "not_found", message: "Node not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    const targetNodeKey = storageKeyToNodeKey(targetStorageKey);
    // Virtual nodes get short cache; real CAS nodes are immutable
    const cacheControl = virtualNodes.has(targetStorageKey)
      ? "no-cache"
      : "public, max-age=31536000, immutable";

    switch (node.kind) {
      case "dict": {
        // Always return JSON directory listing for d-nodes
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
        return new Response(
          JSON.stringify({ type: "dict", key: targetNodeKey, children }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              "Cache-Control": cacheControl,
              "X-CAS-Key": targetNodeKey,
            },
          }
        );
      }

      case "file": {
        const contentType = node.fileInfo?.contentType || "application/octet-stream";
        const stream = openFileStream(ctx, targetStorageKey);
        return new Response(stream, {
          status: 200,
          headers: {
            "Content-Type": contentType,
            "Cache-Control": cacheControl,
            "X-CAS-Key": targetNodeKey,
          },
        });
      }

      default:
        return new Response(
          JSON.stringify({
            error: "unsupported_node_type",
            message: `${node.kind} nodes cannot be served as page content`,
          }),
          { status: 422, headers: { "Content-Type": "application/json" } }
        );
    }
  } catch (err) {
    console.error("[SW] handlePageFetch error:", err);
    return new Response(
      JSON.stringify({
        error: "internal_error",
        message: err instanceof Error ? err.message : "Failed to serve page content",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

// ============================================================================
// View Composition — /view?target=<cas-uri>&viewer=<cas-uri>
//
// Composes a virtual d-node from a viewer DAG + target DAG:
//   root (virtual d-node)
//   ├── index.html     ← bootstrap HTML (served by SW, not in d-node)
//   ├── index.js       ← from viewer
//   ├── style.css      ← from viewer (if present)
//   ├── ...            ← other viewer resources
//   └── _target/       ← target DAG mounted here
//
// The composed d-node is stored in the virtual overlay (SW memory only).
// Redirects to /page/nod_{HASH}/index.html so relative paths work naturally.
// ============================================================================

/**
 * List available built-in viewers.
 * Lazily initializes them on first request, storing node data in virtualNodes.
 */
async function handleBuiltinViewersList(): Promise<Response> {
  try {
    const viewers = await initBuiltinViewers(getKeyProvider(), virtualNodes);
    return new Response(
      JSON.stringify({
        viewers: viewers.map((v) => ({
          name: v.name,
          description: v.description,
          nodeKey: v.nodeKey,
          contentTypes: v.contentTypes,
        })),
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-cache" },
      }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({
        error: "internal_error",
        message: err instanceof Error ? err.message : "Failed to init built-in viewers",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

async function handleViewCompose(url: URL): Promise<Response> {
  if (!client) {
    return new Response(
      JSON.stringify({ error: "not_authenticated", message: "Service Worker not authenticated" }),
      { status: 401, headers: { "Content-Type": "application/json" } }
    );
  }

  const targetUri = url.searchParams.get("target");
  const viewerUri = url.searchParams.get("viewer");

  if (!targetUri || !viewerUri) {
    return new Response(
      JSON.stringify({
        error: "invalid_request",
        message: "Both 'target' and 'viewer' query parameters are required",
      }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  try {
    const ctx = createPageContext(client);

    // Resolve target and viewer to storage keys (support nod_ and path navigation)
    const targetStorageKey = await resolveUriToStorageKey(ctx, targetUri);
    if (typeof targetStorageKey !== "string") return targetStorageKey;

    const viewerStorageKey = await resolveUriToStorageKey(ctx, viewerUri);
    if (typeof viewerStorageKey !== "string") return viewerStorageKey;

    // Read viewer d-node to get its children
    const viewerNode = await getNode(ctx, viewerStorageKey);
    if (!viewerNode || viewerNode.kind !== "dict") {
      return new Response(
        JSON.stringify({
          error: "invalid_viewer",
          message: "Viewer must be a dict node (d-node / directory)",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Compose: viewer children + _target → new d-node
    const childNames = [...(viewerNode.childNames ?? []), "_target"];
    const children = [
      ...(viewerNode.children ?? []),
      keyToHash(targetStorageKey),
    ];

    // Encode the virtual d-node (pure computation, no storage write)
    const encoded = await encodeDictNode({ children, childNames }, getKeyProvider());
    const composedStorageKey = hashToKey(encoded.hash);

    // Store in virtual overlay
    putVirtualNode(composedStorageKey, encoded.bytes);
    virtualRoots.add(composedStorageKey);

    // Redirect to /page/ so relative paths work
    const composedNodeKey = storageKeyToNodeKey(composedStorageKey);
    const redirectUrl = `/page/${composedNodeKey}/index.html`;

    console.log(
      "[SW] View composed:",
      `viewer=${viewerUri}`,
      `target=${targetUri}`,
      `→ ${composedNodeKey}`
    );

    return Response.redirect(redirectUrl, 302);
  } catch (err) {
    console.error("[SW] handleViewCompose error:", err);
    return new Response(
      JSON.stringify({
        error: "internal_error",
        message: err instanceof Error ? err.message : "Failed to compose view",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

/**
 * Resolve a CAS URI string to a storage key.
 * Supports bare node keys (nod_XXX) and paths (nod_XXX/subdir/file).
 * Returns the storage key string on success, or a Response on error.
 */
async function resolveUriToStorageKey(
  ctx: CasContext,
  uri: string
): Promise<string | Response> {
  // Strip optional cas:// prefix
  const bare = uri.startsWith("cas://") ? uri.slice(6) : uri;

  const parts = bare.split("/");
  const rootKey = parts[0] ?? "";
  const pathSegments = parts.slice(1).filter(Boolean);

  if (!rootKey.startsWith("nod_")) {
    // TODO: support dpt_ URIs (requires depot resolution)
    return new Response(
      JSON.stringify({
        error: "unsupported_uri",
        message: `Only nod_ URIs are currently supported, got: ${rootKey}`,
      }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  let storageKey = nodeKeyToStorageKey(rootKey);

  if (pathSegments.length > 0) {
    const nav = await navigatePath(ctx, storageKey, pathSegments);
    if ("error" in nav) {
      return new Response(
        JSON.stringify({ error: "navigation_failed", message: nav.error }),
        { status: nav.status, headers: { "Content-Type": "application/json" } }
      );
    }
    storageKey = nav.storageKey;
  }

  return storageKey;
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

  // 2. Ensure client is available (may need lazy recovery after SW restart)
  await ensureClient();
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
  const navSegments = parts.slice(1).filter(Boolean).map(decodeURIComponent);

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
        cache.put(cacheKey, response.clone()).catch(() => { });
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
        cache.put(cacheKey, response.clone()).catch(() => { });
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
  syncCoordinator.runSync().catch(() => { });
});
