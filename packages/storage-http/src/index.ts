/**
 * @casfa/storage-http
 *
 * HTTP-backed StorageProvider — wraps CASFA node API as CAS storage.
 */

export {
  batchPut,
  createHttpStorage,
  type HttpStorageConfig,
  type HttpStorageProvider,
  type NodeStatus,
  type PutManyResult,
} from "./http-storage.ts";
