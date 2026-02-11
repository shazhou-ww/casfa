/**
 * @casfa/storage-http
 *
 * HTTP-backed StorageProvider — wraps CASFA node API as CAS storage.
 */

export {
  batchPut,
  type CheckManyResult,
  createHttpStorage,
  type HttpStorageConfig,
  type HttpStorageProvider,
  type NodeStatus,
} from "./http-storage.ts";
