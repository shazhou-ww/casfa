/**
 * SW mode — CasfaClient API routed to Service Worker via Comlink.
 *
 * Returns an AppClient identical to createDirectClient, except all CasfaClient
 * methods are proxied through Comlink to a single CasfaClient in the SW.
 *
 * Sync properties (getState, getServerInfo) are cached locally and updated
 * via BroadcastChannel. Namespace methods are fully transparent — the caller
 * cannot tell the difference from a local CasfaClient.
 */

import type {
  CasfaClient,
  DelegateMethods,
  DepotMethods,
  FsMethods,
  NodeMethods,
  OAuthMethods,
  StoredAccessToken,
  TokenMethods,
  TokenState,
} from "@casfa/client";
import * as Comlink from "comlink";
import type { Remote } from "comlink";
import type { BroadcastMessage } from "./messages.ts";
import type { ServerInfo, SwApi, SwInitState } from "./sw-api-types.ts";
import type {
  AppClient,
  AppClientConfig,
  ConflictEvent,
  SyncCommitEvent,
  SyncErrorEvent,
  SyncState,
} from "./types.ts";
import type { ViewerMethods } from "./viewer-types.ts";

// ============================================================================
// Timeout wrapper — Comlink has no built-in timeout
// ============================================================================

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`RPC timeout (${ms}ms): ${label}`)), ms)
    ),
  ]);
}

// ============================================================================
// SW registration and activation
// ============================================================================

/**
 * Wait for a ServiceWorkerRegistration to have an active worker.
 */
async function waitForActive(reg: ServiceWorkerRegistration): Promise<ServiceWorker> {
  // Prefer an incoming SW (installing/waiting) over the current active one.
  // When skipWaiting() is used, the incoming SW will replace the active one,
  // killing its ports. Connecting to the old active SW causes a dead channel.
  const incoming = reg.installing ?? reg.waiting;
  if (incoming) {
    if (incoming.state === "activated") return incoming;
    return new Promise((resolve, reject) => {
      const onChange = () => {
        if (incoming.state === "activated") {
          incoming.removeEventListener("statechange", onChange);
          resolve(incoming);
        } else if (incoming.state === "redundant") {
          incoming.removeEventListener("statechange", onChange);
          reject(new Error("Service worker became redundant"));
        }
      };
      incoming.addEventListener("statechange", onChange);
    });
  }
  if (reg.active) return reg.active;
  throw new Error("No service worker in registration");
}

// ============================================================================
// Namespace wrapper — wraps Remote namespace with timeout
// ============================================================================

/**
 * Create a namespace proxy that wraps each method call with timeout.
 *
 * Comlink's Remote<T> makes method calls return Promise<ReturnType>.
 * We wrap each call with our timeout logic.
 */
function createNamespaceWithTimeout<T extends object>(
  remoteNamespace: Remote<T>,
  nsName: string,
  timeoutMs: number
): T {
  return new Proxy({} as T, {
    get(_, method: string) {
      return async (...args: unknown[]) => {
        const fn = (remoteNamespace as Record<string, (...a: unknown[]) => Promise<unknown>>)[
          method
        ];
        if (typeof fn !== "function") {
          throw new Error(`${nsName}.${method} is not a function`);
        }
        return withTimeout(fn(...args), timeoutMs, `${nsName}.${method}`);
      };
    },
  });
}

// ============================================================================
// Main export
// ============================================================================

export async function createSWClient(config: AppClientConfig): Promise<AppClient> {
  const timeoutMs = config.rpcTimeoutMs ?? 120_000;

  // ── 1. Register SW and wait for activation ──
  const swUrl = config.swUrl ?? "/sw.js";
  const reg = await navigator.serviceWorker.register(swUrl, {
    type: "module",
    scope: config.swScope,
  });
  const sw = await waitForActive(reg);

  // ── 2. MessageChannel + Comlink setup ──
  const { port1, port2 } = new MessageChannel();
  port1.start();

  // Send port to SW for Comlink.expose()
  sw.postMessage({ type: "comlinkInit", port: port2 }, [port2]);

  // Wrap the remote API with Comlink
  const remote = Comlink.wrap<SwApi>(port1);

  // ── 3. Get initial state with timeout ──
  const initState: SwInitState = await withTimeout(
    remote.getInitialState(),
    timeoutMs,
    "getInitialState"
  );

  // ── 4. Cached sync properties ──
  // getState() and getServerInfo() are synchronous on CasfaClient.
  // We cache and keep updated via broadcasts.
  let cachedTokenState: TokenState = initState.tokenState ?? {
    user: null,
    rootDelegate: null,
  };
  let cachedServerInfo: ReturnType<CasfaClient["getServerInfo"]> =
    initState.serverInfo as ReturnType<CasfaClient["getServerInfo"]>;
  let cachedSyncState: SyncState = initState.syncState ?? "idle";
  let cachedPendingCount: number = initState.pendingCount ?? 0;

  // Mirror initial token state to main-thread storage so direct
  // localStorage reads (e.g. OAuthAuthorizePage) work after SW activation.
  if (cachedTokenState.user && config.tokenStorage) {
    config.tokenStorage.save(cachedTokenState).catch(() => { });
  }

  // ── 5. Events (BroadcastChannel "casfa") ──
  const bc = new BroadcastChannel("casfa");
  const listeners = {
    syncState: new Set<(s: SyncState) => void>(),
    conflict: new Set<(e: ConflictEvent) => void>(),
    syncError: new Set<(e: SyncErrorEvent) => void>(),
    commit: new Set<(e: SyncCommitEvent) => void>(),
    pendingCount: new Set<(n: number) => void>(),
  };

  bc.onmessage = (e: MessageEvent) => {
    const msg = e.data as BroadcastMessage;
    switch (msg.type) {
      case "sync-state":
        cachedSyncState = msg.payload;
        listeners.syncState.forEach((fn) => fn(msg.payload));
        break;
      case "conflict":
        listeners.conflict.forEach((fn) => fn(msg.payload));
        break;
      case "sync-error":
        listeners.syncError.forEach((fn) => fn(msg.payload));
        break;
      case "commit":
        listeners.commit.forEach((fn) => fn(msg.payload));
        break;
      case "pending-count":
        cachedPendingCount = msg.payload;
        listeners.pendingCount.forEach((fn) => fn(msg.payload));
        break;
      case "auth-required":
        config.onAuthRequired?.();
        break;
      case "token-state-changed":
        cachedTokenState = msg.payload;
        // Mirror token state to main-thread storage (localStorage) so that
        // pages that read directly from localStorage (e.g. OAuthAuthorizePage)
        // can find the token after a full page reload.
        config.tokenStorage?.save(msg.payload).catch(() => { });
        break;
    }
  };

  // ── 6. Cached namespace proxies with timeout ──
  const ns = {
    oauth: createNamespaceWithTimeout<OAuthMethods>(
      remote.oauth as unknown as Remote<OAuthMethods>,
      "oauth",
      timeoutMs
    ),
    tokens: createNamespaceWithTimeout<TokenMethods>(
      remote.tokens as unknown as Remote<TokenMethods>,
      "tokens",
      timeoutMs
    ),
    delegates: createNamespaceWithTimeout<DelegateMethods>(
      remote.delegates as unknown as Remote<DelegateMethods>,
      "delegates",
      timeoutMs
    ),
    depots: createNamespaceWithTimeout<DepotMethods>(
      remote.depots as unknown as Remote<DepotMethods>,
      "depots",
      timeoutMs
    ),
    fs: createNamespaceWithTimeout<FsMethods>(
      remote.fs as unknown as Remote<FsMethods>,
      "fs",
      timeoutMs
    ),
    nodes: createNamespaceWithTimeout<NodeMethods>(
      remote.nodes as unknown as Remote<NodeMethods>,
      "nodes",
      timeoutMs
    ),
    viewers: createNamespaceWithTimeout<ViewerMethods>(
      remote.viewers as unknown as Remote<ViewerMethods>,
      "viewers",
      timeoutMs
    ),
  };

  // ── 7. AppClient ──
  return {
    // ── CasfaClient: namespaces (Comlink proxy with timeout) ──
    get oauth() {
      return ns.oauth;
    },
    get tokens() {
      return ns.tokens;
    },
    get delegates() {
      return ns.delegates;
    },
    get depots() {
      return ns.depots;
    },
    get fs() {
      return ns.fs;
    },
    get nodes() {
      return ns.nodes;
    },
    get viewers() {
      return ns.viewers;
    },

    // ── CasfaClient: sync properties (cached locally) ──
    getState() {
      return cachedTokenState;
    },
    getServerInfo() {
      return cachedServerInfo;
    },
    setRootDelegate(delegate) {
      // Fire-and-forget — state updates arrive via broadcast
      remote.setRootDelegate(delegate);
    },
    async getAccessToken() {
      return withTimeout(remote.getAccessToken(), timeoutMs, "getAccessToken") as Promise<
        StoredAccessToken | null
      >;
    },

    // ── AppClient: auth ──
    async setUserToken(userId: string) {
      await withTimeout(remote.setUserToken(userId), timeoutMs, "setUserToken");
      // Refresh cached state from SW
      cachedTokenState = await withTimeout(
        Promise.resolve(remote.getState()),
        timeoutMs,
        "getState"
      );
      cachedServerInfo = (await withTimeout(
        Promise.resolve(remote.getServerInfo()),
        timeoutMs,
        "getServerInfo"
      )) as ReturnType<CasfaClient["getServerInfo"]>;
    },

    // ── AppClient: sync ──
    scheduleCommit(depotId, newRoot, lastKnownServerRoot) {
      const postCommit = () => {
        // Fire-and-forget via raw postMessage (not Comlink)
        port1.postMessage({
          type: "schedule-commit",
          depotId,
          targetRoot: newRoot,
          lastKnownServerRoot,
        });
      };

      // Layer 1: flush buffered CAS nodes from main-thread cache → server
      if (config.storage) {
        config.storage
          .flush()
          .then(postCommit)
          .catch((err) => {
            console.error("[casfa] Layer 1 flush failed, skipping commit:", err);
          });
      } else {
        postCommit();
      }
    },

    async getPendingRoot(depotId) {
      return withTimeout(Promise.resolve(remote.getPendingRoot(depotId)), timeoutMs, "getPendingRoot");
    },

    async flushNow() {
      await withTimeout(remote.flushNow(), timeoutMs, "flushNow");
    },

    // ── AppClient: events ──
    onSyncStateChange(fn) {
      listeners.syncState.add(fn);
      // Fire current state immediately so new subscribers get initial value
      fn(cachedSyncState);
      return () => {
        listeners.syncState.delete(fn);
      };
    },
    onConflict(fn) {
      listeners.conflict.add(fn);
      return () => {
        listeners.conflict.delete(fn);
      };
    },
    onSyncError(fn) {
      listeners.syncError.add(fn);
      return () => {
        listeners.syncError.delete(fn);
      };
    },
    onCommit(fn) {
      listeners.commit.add(fn);
      return () => {
        listeners.commit.delete(fn);
      };
    },
    onPendingCountChange(fn) {
      listeners.pendingCount.add(fn);
      fn(cachedPendingCount);
      return () => {
        listeners.pendingCount.delete(fn);
      };
    },

    // ── AppClient: lifecycle ──
    async logout() {
      await withTimeout(remote.logout(), timeoutMs, "logout");
      cachedTokenState = { user: null, rootDelegate: null };
      cachedServerInfo = null;
    },

    dispose() {
      port1.close();
      bc.close();
      listeners.syncState.clear();
      listeners.conflict.clear();
      listeners.syncError.clear();
      listeners.commit.clear();
      listeners.pendingCount.clear();
      // Release Comlink proxy
      remote[Comlink.releaseProxy]();
    },
  };
}
