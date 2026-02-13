/**
 * @casfa/client-bridge — message protocol types
 *
 * Defines all message types for Main ↔ SW communication.
 * Used by both client-bridge (main thread) and client-sw (SW thread).
 *
 * Internal module — exported from @casfa/client-bridge as types.
 */

import type { CasfaClient, TokenState } from "@casfa/client";
import type {
  ConflictEvent,
  SyncCommitEvent,
  SyncErrorEvent,
  SyncState,
} from "@casfa/explorer/core/sync-manager";
import type { RPCResponse } from "@casfa/port-rpc";

export type { RPCResponse };

// ============================================================================
// Main → SW — via navigator.serviceWorker.controller.postMessage
// ============================================================================

/**
 * Initial connection handshake. Sent via SW.postMessage.
 * Carries a MessagePort as transferable (in the transfer list, not in data).
 */
export type ConnectMessage = {
  type: "connect";
};

// ============================================================================
// Main → SW — via MessagePort (RPC with response)
// ============================================================================

/** Set user identity — creates/replaces CasfaClient in SW with correct realm. */
export type SetUserTokenMessage = {
  type: "set-user-token";
  id: number;
  userId: string;
};

/** Generic RPC — routes to CasfaClient namespace or top-level method. */
export type RPCRequest = {
  type: "rpc";
  id: number;
  target: string; // "oauth" | "tokens" | "delegates" | "depots" | "fs" | "nodes" | "client"
  method: string;
  args: unknown[];
};

/** Get pending root for a depot (Phase 3: SyncCoordinator). */
export type GetPendingRootMessage = {
  type: "get-pending-root";
  id: number;
  depotId: string;
};

/** Force-flush all pending sync. */
export type FlushNowMessage = {
  type: "flush-now";
  id: number;
};

/** Flush + logout + cleanup. */
export type LogoutMessage = {
  type: "logout";
  id: number;
};

// ============================================================================
// Main → SW — via MessagePort (fire-and-forget, no response)
// ============================================================================

/** Enqueue a depot commit (Phase 3: SyncCoordinator). */
export type ScheduleCommitMessage = {
  type: "schedule-commit";
  depotId: string;
  targetRoot: string;
  lastKnownServerRoot: string | null;
};

// ============================================================================
// SW → Main — via MessagePort (responses)
// ============================================================================

/** Response to ConnectMessage — initial state snapshot. */
export type ConnectAckMessage = {
  type: "connect-ack";
  authenticated: boolean;
  tokenState: TokenState | null;
  serverInfo: ReturnType<CasfaClient["getServerInfo"]>;
  syncState: SyncState;
  pendingCount: number;
};

// ============================================================================
// SW → All Tabs — via BroadcastChannel "casfa"
// ============================================================================

export type BroadcastMessage =
  | { type: "sync-state"; payload: SyncState }
  | { type: "conflict"; payload: ConflictEvent }
  | { type: "sync-error"; payload: SyncErrorEvent }
  | { type: "commit"; payload: SyncCommitEvent }
  | { type: "pending-count"; payload: number }
  | { type: "auth-required" }
  | { type: "token-state-changed"; payload: TokenState };

// ============================================================================
// Union types
// ============================================================================

/** Distributive Omit — applies Omit to each member of a union separately. */
type DistributiveOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never;

/** All port messages from main thread that expect an RPC response. */
export type RPCCallable = DistributiveOmit<
  SetUserTokenMessage | RPCRequest | GetPendingRootMessage | FlushNowMessage | LogoutMessage,
  "id"
>;

/** All port messages from main thread. */
export type PortMessage =
  | SetUserTokenMessage
  | RPCRequest
  | ScheduleCommitMessage
  | GetPendingRootMessage
  | FlushNowMessage
  | LogoutMessage;
