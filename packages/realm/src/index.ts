// Realm facade (design) API

// Errors
export type { RealmError, RealmErrorCode } from "./errors.ts";
export { createRealmError, isRealmError } from "./errors.ts";
export { createMemoryDelegateStore } from "./memory-delegate-store.ts";
export { createRealmFacade } from "./realm-facade.ts";
export type { Depot, DepotStore } from "./realm-legacy-types.ts";

// Legacy (deprecated): use createRealmFacade + DelegateFacade
export type { RealmService, RealmServiceContext } from "./realm-service.ts";
export { createRealmService } from "./realm-service.ts";
export type {
  Delegate,
  DelegateFacade,
  DelegateOptions,
  DelegateStore,
  RealmFacade,
  RealmFacadeContext,
  RealmInfo,
} from "./types.ts";
