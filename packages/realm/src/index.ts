/**
 * @casfa/realm
 * Realm core: single-root file tree, delegate tree, local commit, GC.
 */
export type { RealmError, RealmErrorCode } from "./errors.ts";
export { isRealmError } from "./errors.ts";
export type { BlobStore, DelegateDb } from "./storage.ts";
export type { Delegate, RealmStats } from "./types.ts";
export { generateDelegateId } from "./id.ts";
export { resolvePath, validateNameOnlyPath } from "./path.ts";
export type { GetNode } from "./path.ts";
export { replaceSubtreeAtPath } from "./merge.ts";
export type { MergeContext } from "./merge.ts";
export { RealmService } from "./realm-service.ts";
export type {
  RealmServiceDeps,
  CreateRootDelegateOptions,
  CreateChildDelegateOptions,
  ReadResult,
  PutResult,
  CommitResult,
} from "./realm-service.ts";
