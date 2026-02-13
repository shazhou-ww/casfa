/**
 * SW mode — CasfaClient API routed to Service Worker via MessagePort RPC.
 *
 * Returns an AppClient identical to createDirectClient, except all CasfaClient
 * methods are proxied through RPC to a single CasfaClient in the SW.
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
import { createNamespaceProxy, createRPC } from "@casfa/port-rpc";
import { nodeKeyToStorageKey } from "@casfa/protocol";
import type { BroadcastMessage, ConnectAckMessage } from "./messages.ts";
import type {
  AppClient,
  AppClientConfig,
  ConflictEvent,
  SyncCommitEvent,
  SyncErrorEvent,
  SyncState,
} from "./types.ts";

/**
 * Wait for a ServiceWorkerRegistration to have an active worker.
 */
async function waitForActive(reg: ServiceWorkerRegistration): Promise<ServiceWorker> {
  if (reg.active) return reg.active;
  const sw = reg.installing ?? reg.waiting;
  if (!sw) throw new Error("No service worker in registration");
  return new Promise((resolve, reject) => {
    const onChange = () => {
      if (sw.state === "activated") {
        sw.removeEventListener("statechange", onChange);
        resolve(sw);
      } else if (sw.state === "redundant") {
        sw.removeEventListener("statechange", onChange);
        reject(new Error("Service worker became redundant"));
      }
    };
    sw.addEventListener("statechange", onChange);
  });
}

export async function createSWClient(config: AppClientConfig): Promise<AppClient> {
  const timeoutMs = config.rpcTimeoutMs ?? 30_000;

  // ── 1. Register SW and wait for activation ──
  const swUrl = config.swUrl ?? "/sw.js";
  const reg = await navigator.serviceWorker.register(swUrl, {
    type: "module",
  });
  const sw = await waitForActive(reg);

  // ── 2. MessageChannel + connect handshake ──
  const { port1, port2 } = new MessageChannel();
  port1.start();

  // Listen for connect-ack BEFORE sending connect to avoid race
  const ackPromise = new Promise<ConnectAckMessage>((resolve, reject) => {
    const timer = setTimeout(() => {
      port1.removeEventListener("message", handler);
      reject(new Error("SW connect timeout"));
    }, timeoutMs);

    const handler = (e: MessageEvent) => {
      if (e.data?.type === "connect-ack") {
        clearTimeout(timer);
        port1.removeEventListener("message", handler);
        resolve(e.data as ConnectAckMessage);
      }
    };
    port1.addEventListener("message", handler);
  });

  sw.postMessage({ type: "connect" }, [port2]);
  const ack = await ackPromise;

  // ── 3. RPC layer (all subsequent port messages go through here) ──
  const rpc = createRPC(port1, { timeoutMs });

  // ── 4. Cached sync properties ──
  // getState() and getServerInfo() are synchronous on CasfaClient.
  // Over RPC they'd be async, so we cache and keep updated via broadcasts.
  let cachedTokenState: TokenState = ack.tokenState ?? {
    user: null,
    rootDelegate: null,
  };
  let cachedServerInfo: ReturnType<CasfaClient["getServerInfo"]> = ack.serverInfo;
  let cachedSyncState: SyncState = ack.syncState ?? "idle";
  let cachedPendingCount: number = ack.pendingCount ?? 0;

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
        listeners.syncState.forEach((fn) => {
          fn(msg.payload);
        });
        break;
      case "conflict":
        listeners.conflict.forEach((fn) => {
          fn(msg.payload);
        });
        break;
      case "sync-error":
        listeners.syncError.forEach((fn) => {
          fn(msg.payload);
        });
        break;
      case "commit":
        listeners.commit.forEach((fn) => {
          fn(msg.payload);
        });
        break;
      case "pending-count":
        cachedPendingCount = msg.payload;
        listeners.pendingCount.forEach((fn) => {
          fn(msg.payload);
        });
        break;
      case "auth-required":
        config.onAuthRequired?.();
        break;
      case "token-state-changed":
        cachedTokenState = msg.payload;
        break;
    }
  };

  // ── 6. Namespace proxies (cached, one per namespace) ──
  const ns = {
    oauth: createNamespaceProxy<OAuthMethods>(rpc, "oauth"),
    tokens: createNamespaceProxy<TokenMethods>(rpc, "tokens"),
    delegates: createNamespaceProxy<DelegateMethods>(rpc, "delegates"),
    depots: createNamespaceProxy<DepotMethods>(rpc, "depots"),
    fs: createNamespaceProxy<FsMethods>(rpc, "fs"),
    nodes: createNamespaceProxy<NodeMethods>(rpc, "nodes"),
  };

  // ── 7. AppClient ──
  return {
    // ── CasfaClient: namespaces (RPC proxy) ──
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

    // ── CasfaClient: sync properties (cached locally) ──
    getState() {
      return cachedTokenState;
    },
    getServerInfo() {
      return cachedServerInfo;
    },
    setRootDelegate(delegate) {
      // Fire-and-forget RPC — state updates arrive via broadcast
      rpc({
        type: "rpc",
        target: "client",
        method: "setRootDelegate",
        args: [delegate],
      }).catch(() => {});
    },
    getAccessToken() {
      return rpc({
        type: "rpc",
        target: "client",
        method: "getAccessToken",
        args: [],
      }) as Promise<StoredAccessToken | null>;
    },

    // ── AppClient: auth ──
    async setUserToken(userId: string) {
      await rpc({ type: "set-user-token", userId });
      // Refresh cached state from SW
      cachedTokenState = (await rpc({
        type: "rpc",
        target: "client",
        method: "getState",
        args: [],
      })) as TokenState;
      cachedServerInfo = (await rpc({
        type: "rpc",
        target: "client",
        method: "getServerInfo",
        args: [],
      })) as ReturnType<CasfaClient["getServerInfo"]>;
    },

    // ── AppClient: sync ──
    scheduleCommit(depotId, newRoot, lastKnownServerRoot) {
      const postCommit = () => {
        port1.postMessage({
          type: "schedule-commit",
          depotId,
          targetRoot: newRoot,
          lastKnownServerRoot,
        });
      };

      // Layer 1: sync CAS nodes from main-thread cache → server
      if (config.storage?.syncTree) {
        const storageKey = nodeKeyToStorageKey(newRoot);
        config.storage
          .syncTree(storageKey)
          .then(postCommit)
          .catch((err) => {
            console.error("[casfa] Layer 1 syncTree failed, skipping commit:", err);
          });
      } else {
        postCommit();
      }
    },

    async getPendingRoot(depotId) {
      return (await rpc({
        type: "get-pending-root",
        depotId,
      })) as string | null;
    },

    async flushNow() {
      await rpc({ type: "flush-now" });
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
      await rpc({ type: "logout" });
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
    },
  };
}
