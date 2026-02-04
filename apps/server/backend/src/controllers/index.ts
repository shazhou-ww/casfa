/**
 * Controllers exports
 */

export { type AdminController, createAdminController } from "./admin.ts";
export { type AuthClientsController, createAuthClientsController } from "./auth-clients.ts";
export { type AuthTokensController, createAuthTokensController } from "./auth-tokens.ts";
export { type ChunksController, createChunksController } from "./chunks.ts";
export { createDepotsController, type DepotsController } from "./depots.ts";
export { createHealthController, type HealthController } from "./health.ts";
export { createInfoController, type InfoController, type InfoControllerDeps } from "./info.ts";
export { createOAuthController, type OAuthController } from "./oauth.ts";
export { createRealmController, type RealmController } from "./realm.ts";
export { createTicketsController, type TicketsController } from "./tickets.ts";
