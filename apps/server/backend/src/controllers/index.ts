/**
 * Controllers exports
 */

// ============================================================================
// Delegate Token Controllers
// ============================================================================

export {
  createTokenRequestsController,
  type TokenRequestsController,
  type TokenRequestsControllerDeps,
} from "./token-requests.ts";
export {
  createTokensController,
  type TokensController,
  type TokensControllerDeps,
} from "./tokens.ts";

// ============================================================================
// New Delegate Model Controllers
// ============================================================================

export {
  createDelegatesController,
  type DelegatesController,
  type DelegatesControllerDeps,
} from "./delegates.ts";
export {
  createRootTokenController,
  type RootTokenController,
  type RootTokenControllerDeps,
} from "./root-token.ts";
export {
  createRefreshController,
  type RefreshController,
  type RefreshControllerDeps,
} from "./refresh.ts";
export {
  createClaimController,
  type ClaimController,
  type ClaimControllerDeps,
} from "./claim.ts";

// ============================================================================
// Core Controllers
// ============================================================================

export { type AdminController, createAdminController } from "./admin.ts";
export { type ChunksController, createChunksController } from "./chunks.ts";
export { createDepotsController, type DepotsController } from "./depots.ts";
export {
  createFilesystemController,
  type FilesystemController,
  type FilesystemControllerDeps,
} from "./filesystem.ts";
export { createHealthController, type HealthController } from "./health.ts";
export { createInfoController, type InfoController, type InfoControllerDeps } from "./info.ts";
export { createOAuthController, type OAuthController } from "./oauth.ts";
export { createRealmController, type RealmController } from "./realm.ts";
export { createTicketsController, type TicketsController } from "./tickets.ts";
