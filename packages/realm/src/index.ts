// Level 1 Realm: depot over CAS + dag-diff

export type { RealmError, RealmErrorCode } from "./errors.ts";
export { createRealmError, isRealmError } from "./errors.ts";
export type { RealmService, RealmServiceContext } from "./realm-service.ts";
export { createRealmService } from "./realm-service.ts";
export type { Depot, DepotStore } from "./types.ts";
