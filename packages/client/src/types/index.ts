/**
 * Type exports for @casfa/client
 */

export type {
  ClientConfig,
  ClientError,
  FetchResult,
  OnAuthRequiredCallback,
  OnTokenChangeCallback,
  TokenStorageProvider,
} from "./client.ts";

export type {
  StoredAccessToken,
  StoredRootDelegate,
  StoredUserToken,
  TokenRequirement,
  TokenState,
} from "./tokens.ts";

export { emptyTokenState } from "./tokens.ts";
