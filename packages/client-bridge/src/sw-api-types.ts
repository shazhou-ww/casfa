/**
 * SW API types — the Comlink-exposed interface from Service Worker.
 *
 * This defines the shape of the object exposed via Comlink.expose() in the SW,
 * and wrapped via Comlink.wrap() on the main thread.
 */

import type {
  DelegateMethods,
  DepotMethods,
  FsMethods,
  NodeMethods,
  OAuthMethods,
  StoredAccessToken,
  StoredRootDelegate,
  TokenMethods,
  TokenState,
} from "@casfa/client";
import type { ViewerMethods } from "./viewer-types.ts";

// ============================================================================
// Server info type (matches CasfaClient.getServerInfo return)
// ============================================================================

export type ServerInfo = {
  service: string;
  version: string;
  storage: "fs" | "memory" | "s3";
  auth: "mock" | "cognito" | "tokens-only";
  database: "local" | "aws";
  limits: {
    maxNodeSize: number;
    maxNameBytes: number;
    maxDictChildren: number;
    maxSetChildren: number;
    maxBTreeChildren: number;
    maxFileSize: number;
    maxProofCount: number;
    maxAgentTokenTtl?: number;
  };
  features: {
    createUser: boolean;
  };
} | null;

// ============================================================================
// CasfaClient namespace methods (proxied from client)
// ============================================================================

/**
 * The complete SW API exposed via Comlink.
 *
 * Namespaces (oauth, tokens, delegates, depots, fs, nodes, viewers) are
 * nested objects with async methods. Top-level methods provide state
 * access and lifecycle operations.
 */
export type SwApi = {
  // ── Namespaces (from CasfaClient) ──
  oauth: OAuthMethods;
  tokens: TokenMethods;
  delegates: DelegateMethods;
  depots: DepotMethods;
  fs: FsMethods;
  nodes: NodeMethods;
  viewers: ViewerMethods;

  // ── Top-level CasfaClient methods ──
  getState(): TokenState;
  getServerInfo(): ServerInfo;
  setRootDelegate(delegate: StoredRootDelegate | null): void;
  getAccessToken(): Promise<StoredAccessToken | null>;

  // ── Auth lifecycle ──
  setUserToken(userId: string): Promise<void>;
  logout(): Promise<void>;

  // ── Sync operations ──
  getPendingRoot(depotId: string): string | null;
  flushNow(): Promise<void>;

  // ── Connection state (returned on init) ──
  getInitialState(): SwInitState;
};

/**
 * Initial state returned after Comlink connection.
 * Replaces the connect-ack message.
 */
export type SwInitState = {
  authenticated: boolean;
  tokenState: TokenState | null;
  serverInfo: ServerInfo;
  syncState: "idle" | "syncing" | "error";
  pendingCount: number;
};

/**
 * Fire-and-forget message types — sent via raw postMessage, not Comlink.
 *
 * These are one-way messages that don't need a response.
 */
export type FireAndForgetMessage =
  | {
    type: "schedule-commit";
    depotId: string;
    targetRoot: string;
    lastKnownServerRoot: string | null;
  }
  | {
    type: "comlinkInit";
    port: MessagePort;
  };
