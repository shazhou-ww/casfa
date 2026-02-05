/**
 * Controllers exports
 */

// ============================================================================
// Delegate Token Controllers
// ============================================================================

export {
  createTokensController,
  type TokensController,
  type TokensControllerDeps,
} from "./tokens.ts";

export {
  createTokenRequestsController,
  type TokenRequestsController,
  type TokenRequestsControllerDeps,
} from "./token-requests.ts";

// ============================================================================
// Core Controllers
// ============================================================================

export { type AdminController, createAdminController } from "./admin.ts";
export { type ChunksController, createChunksController } from "./chunks.ts";
export { createDepotsController, type DepotsController } from "./depots.ts";
export { createHealthController, type HealthController } from "./health.ts";
export { createInfoController, type InfoController, type InfoControllerDeps } from "./info.ts";
export { createOAuthController, type OAuthController } from "./oauth.ts";
export { createRealmController, type RealmController } from "./realm.ts";
export { createTicketsController, type TicketsController } from "./tickets.ts";
