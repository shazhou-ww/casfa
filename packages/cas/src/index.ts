/** @deprecated Use CasFacade */
export type { CasError, CasErrorCode, CasFacade, CasFacade as CasService } from "./cas-service.ts";
/** @deprecated Use createCasFacade and CasFacade */
export {
  createCasError,
  createCasFacade,
  createCasFacade as createCasService,
  isCasError,
} from "./cas-service.ts";
export type { BufferCasStorage } from "./cas-storage-adapter.ts";
export { createCasStorageFromBuffer } from "./cas-storage-adapter.ts";
export { bytesFromStream, streamFromBytes } from "./stream-util.ts";
export type {
  BytesStream,
  CasContext,
  CasInfo,
  CasNodeResult,
  CasStorage,
} from "./types.ts";
