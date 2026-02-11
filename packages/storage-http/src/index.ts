/**
 * @casfa/storage-http
 *
 * HTTP-backed StorageProvider — wraps CASFA node API as CAS storage.
 */

export {
  batchPut,
  createHttpStorage,
  type HttpStorageConfig,
  type NodeStatus,
} from "./http-storage.ts";
