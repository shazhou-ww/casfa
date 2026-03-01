// Realm facade (design) API

// Errors
export type { RealmError, RealmErrorCode } from "./errors.ts";
export { createRealmError, isRealmError } from "./errors.ts";
export { createMemoryDelegateStore } from "./memory-delegate-store.ts";
export { createRealmFacade } from "./realm-facade.ts";
export type {
  Delegate,
  DelegateFacade,
  DelegateOptions,
  DelegateStore,
  RealmFacade,
  RealmFacadeContext,
  RealmInfo,
} from "./types.ts";
