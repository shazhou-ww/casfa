/**
 * @casfa/client-bridge
 *
 * Unified AppClient — CasfaClient + sync + auth management.
 * Callers see a single AppClient interface regardless of transport (SW / direct).
 *
 * Phase 1: Direct mode only (main-thread CasfaClient + SyncManager).
 * Phase 2: SW mode (RPC proxy to Service Worker).
 *
 * @packageDocumentation
 */

export { createAppClient, createDirectClient } from "./factory.ts";

export type {
  BroadcastMessage,
  ConnectAckMessage,
  PortMessage,
  RPCCallable,
  RPCRequest,
  RPCResponse,
  ScheduleCommitMessage,
  SetUserTokenMessage,
} from "./messages.ts";
export type {
  AppClient,
  AppClientConfig,
  ConflictEvent,
  SyncCommitEvent,
  SyncErrorEvent,
  SyncState,
} from "./types.ts";
export type {
  AddCustomViewerInput,
  UpdateCustomViewerInput,
  ViewerInfo,
  ViewerMethods,
} from "./viewer-types.ts";
