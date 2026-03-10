/**
 * @casfa/client-sw — message handler
 *
 * Processes port messages from main-thread AppClient instances.
 * Routes RPC calls to a single shared CasfaClient, handles auth
 * lifecycle, and delegates sync operations to SyncCoordinator.
 */

import { type CasfaClient, createClient, type TokenStorageProvider } from "@casfa/client";
import type { BroadcastMessage, PortMessage } from "@casfa/client-bridge";
import { respond, respondError } from "@casfa/port-rpc";

// ============================================================================
// Types
// ============================================================================

export type MessageHandlerDeps = {
  /** Get the current CasfaClient (throws if not authenticated). */
  getClient: () => CasfaClient;
  /** Replace the current CasfaClient (after set-user-token). */
  setClient: (client: CasfaClient) => void;
  /** API base URL for creating new CasfaClient instances. */
  baseUrl: string;
  /** Token persistence provider (IndexedDB). */
  tokenStorage: TokenStorageProvider;
  /** Broadcast a message to all tabs via BroadcastChannel. */
  broadcast: (msg: BroadcastMessage) => void;
  /** SyncCoordinator for depot commit queue management. */
  syncCoordinator: {
    enqueue(depotId: string, targetRoot: string, lastKnownServerRoot: string | null): void;
    flushNow(): Promise<void>;
    getPendingRoot(depotId: string): string | null;
    setClient(client: CasfaClient): void;
  };
};

// ============================================================================
// Whitelists for RPC security
// ============================================================================

const ALLOWED_NAMESPACES = new Set(["oauth", "tokens", "delegates", "depots", "fs", "nodes"]);

const ALLOWED_TOP_LEVEL = new Set([
  "getState",
  "getServerInfo",
  "setRootDelegate",
  "getAccessToken",
]);

// ============================================================================
// Handler factory
// ============================================================================

/**
 * Create a message handler function for processing port messages.
 *
 * The returned function should be wired to `port.onmessage`:
 * ```
 * port.onmessage = (e) => handleMessage(e.data, port);
 * ```
 */
export function createMessageHandler(deps: MessageHandlerDeps) {
  return async function handleMessage(msg: PortMessage, port: MessagePort): Promise<void> {
    switch (msg.type) {
      // ── Auth: set-user-token ──
      case "set-user-token": {
        try {
          const newClient = await createClient({
            baseUrl: deps.baseUrl,
            realm: msg.userId,
            tokenStorage: deps.tokenStorage,
            onAuthRequired: () => deps.broadcast({ type: "auth-required" }),
          });
          deps.setClient(newClient);
          deps.syncCoordinator.setClient(newClient);
          respond(port, msg.id, null);
          // Broadcast updated state to all tabs
          deps.broadcast({
            type: "token-state-changed",
            payload: newClient.getState(),
          });
        } catch (err) {
          respondError(port, msg.id, "set_user_token_error", err);
        }
        break;
      }

      // ── Generic RPC ──
      case "rpc": {
        try {
          const client = deps.getClient();

          // Whitelist validation
          if (msg.target === "client") {
            if (!ALLOWED_TOP_LEVEL.has(msg.method)) {
              throw new Error(`Blocked RPC method: client.${msg.method}`);
            }
          } else if (!ALLOWED_NAMESPACES.has(msg.target)) {
            throw new Error(`Blocked RPC namespace: ${msg.target}`);
          }

          const target =
            msg.target === "client" ? client : (client as Record<string, unknown>)[msg.target];
          const fn =
            msg.target === "client"
              ? (client as Record<string, unknown>)[msg.method]
              : (target as Record<string, unknown>)[msg.method];

          if (typeof fn !== "function") {
            throw new Error(`Not a function: ${msg.target}.${msg.method}`);
          }

          const result = await fn.apply(target, msg.args);

          // Transfer Uint8Array buffers in results for better perf
          const transferables: Transferable[] = [];
          if (
            result &&
            typeof result === "object" &&
            "ok" in result &&
            result.ok &&
            "data" in result &&
            result.data instanceof Uint8Array
          ) {
            transferables.push((result.data as Uint8Array).buffer as ArrayBuffer);
          }

          respond(port, msg.id, result, transferables);
        } catch (err) {
          respondError(port, msg.id, "rpc_error", err);
        }
        break;
      }

      // ── Sync: fire-and-forget ──
      case "schedule-commit":
        deps.syncCoordinator.enqueue(msg.depotId, msg.targetRoot, msg.lastKnownServerRoot);
        break;

      // ── Sync: RPC ──
      case "get-pending-root":
        respond(port, msg.id, deps.syncCoordinator.getPendingRoot(msg.depotId));
        break;

      case "flush-now": {
        try {
          await deps.syncCoordinator.flushNow();
          respond(port, msg.id, null);
        } catch (err) {
          respondError(port, msg.id, "flush_error", err);
        }
        break;
      }

      // ── Lifecycle ──
      case "logout": {
        try {
          await deps.syncCoordinator.flushNow();
          deps.getClient().logout();
          respond(port, msg.id, null);
        } catch (err) {
          respondError(port, msg.id, "logout_error", err);
        }
        break;
      }
    }
  };
}
