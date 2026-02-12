/**
 * @casfa/client-sw
 *
 * Service Worker message handler and IndexedDB token storage.
 * Used by the SW entry (apps/server/frontend/src/sw/sw.ts) to handle
 * RPC messages from main-thread AppClient instances.
 *
 * @packageDocumentation
 */

export {
  createMessageHandler,
  type MessageHandlerDeps,
} from "./message-handler.ts";

export { createIndexedDBTokenStorage } from "./token-storage-idb.ts";
