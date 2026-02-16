/**
 * @casfa/client-bridge — types
 *
 * Unified AppClient type: CasfaClient + sync + auth management.
 * Callers only interact with AppClient — the underlying transport
 * (SW RPC or main-thread direct) is an internal implementation detail.
 */

import type { CasfaClient, TokenStorageProvider } from "@casfa/client";
import type { KeyProvider, StorageProvider } from "@casfa/core";
import type {
  ConflictEvent,
  FlushableStorage,
  SyncCommitEvent,
  SyncErrorEvent,
  SyncQueueStore,
  SyncState,
} from "@casfa/explorer/core/sync-manager";

// Re-export event types for convenience
export type { ConflictEvent, SyncCommitEvent, SyncErrorEvent, SyncState };

// ============================================================================
// AppClient — CasfaClient superset
// ============================================================================

/**
 * CasfaClient + sync + auth management.
 *
 * Two construction modes (SW / direct) return the same interface.
 * All CasfaClient methods (oauth, tokens, delegates, depots, fs, nodes,
 * getState, getServerInfo, etc.) are available directly on AppClient.
 */
export type AppClient = CasfaClient & {
  /**
   * Push user JWT. Creates/replaces the underlying CasfaClient with
   * autonomous refresh. Call again to re-login (overwrites old token).
   */
  setUserToken(userId: string): Promise<void>;

  // ── Sync ──

  /** Enqueue a depot root for background commit. */
  scheduleCommit(depotId: string, newRoot: string, lastKnownServerRoot: string | null): void;

  /** Get the pending (uncommitted) target root for a depot, or null. */
  getPendingRoot(depotId: string): Promise<string | null>;

  /** Force-flush all pending sync (Layer 1 CAS + Layer 2 depot commits). */
  flushNow(): Promise<void>;

  // ── Events ──

  onSyncStateChange(fn: (state: SyncState) => void): () => void;
  onConflict(fn: (event: ConflictEvent) => void): () => void;
  onSyncError(fn: (event: SyncErrorEvent) => void): () => void;
  onCommit(fn: (event: SyncCommitEvent) => void): () => void;
  onPendingCountChange(fn: (count: number) => void): () => void;

  /** Flush pending sync → logout → clean up resources. */
  logout(): Promise<void>;

  /** Release all internal resources (port, BroadcastChannel, timers). */
  dispose(): void;
};

// ============================================================================
// AppClientConfig
// ============================================================================

/**
 * Configuration for creating an AppClient.
 *
 * `storage` is used in both direct mode (main-thread sync) and SW mode
 * (Layer 1 flush runs on main thread before enqueuing commit in SW).
 * `queueStore` is only used in direct mode.
 */
export type AppClientConfig = {
  /** API base URL (usually "" for same-origin). */
  baseUrl: string;

  /** Realm identifier (usually user ID). */
  realm: string;

  /** Token persistence provider (direct mode). */
  tokenStorage?: TokenStorageProvider;

  /** Callback when all token refresh attempts fail. */
  onAuthRequired?: () => void;

  // ── Sync (direct mode) ──

  /** Layer 1 storage with flush() — syncs buffered CAS nodes to remote before committing. */
  storage?: FlushableStorage;

  /** Persistent depot sync queue store. */
  queueStore?: SyncQueueStore;

  /** Sync debounce delay in ms (default: 2000). */
  syncDebounceMs?: number;

  // ── 3-way merge (direct mode) ──

  /**
   * Lazy StorageProvider getter for reading/writing nodes during merge.
   * When provided along with `keyProvider`, enables 3-way merge on commit conflicts.
   * This should return the same StorageProvider that backs the FlushableStorage.
   *
   * Uses a lazy getter to avoid circular init with `getStorage()` / `getAppClient()`.
   * Called only when a merge is actually needed (conflict on commit).
   */
  getLocalStorage?: () => Promise<StorageProvider>;

  /**
   * Key provider for creating new nodes during merge apply.
   * Required together with `localStorage` to enable 3-way merge.
   */
  keyProvider?: KeyProvider;

  // ── SW mode ──

  /** SW script URL (default: "/sw.js"). Only used in SW mode. */
  swUrl?: string | URL;

  /** RPC timeout in ms (default: 30000). Only used in SW mode. */
  rpcTimeoutMs?: number;
};
