/// <reference lib="webworker" />
declare const self: ServiceWorkerGlobalScope;

/**
 * CASFA Service Worker — thin shell
 *
 * Delegates all message handling to @casfa/client-sw.
 * Holds a single CasfaClient instance shared across all connected tabs.
 * Phase 2: CasfaClient RPC only (no SyncCoordinator).
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
    };
    port.postMessage(ack);

    // Wire up message handler for this port
    port.onmessage = (e) => handleMessage(e.data, port);
    port.start();
  }
});
