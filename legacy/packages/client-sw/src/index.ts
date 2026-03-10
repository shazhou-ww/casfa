/**
 * @casfa/client-sw
 *
 * Service Worker utilities for CASFA — IndexedDB token storage.
 * The RPC layer is now handled by Comlink directly in sw.ts.
 *
 * @packageDocumentation
 */

export { createIndexedDBTokenStorage } from "./token-storage-idb.ts";
