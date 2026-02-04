/**
 * Middleware exports
 */

export {
  type AuthMiddlewareDeps,
  createAuthMiddleware,
  createOptionalAuthMiddleware,
  type JwtVerifier,
} from "./auth.ts";

export {
  createAdminAccessMiddleware,
  createRealmAccessMiddleware,
  createWriteAccessMiddleware,
} from "./realm-access.ts";

export {
  checkTicketReadAccess,
  checkTicketWriteQuota,
  createTicketAuthMiddleware,
  type TicketAuthDeps,
} from "./ticket-auth.ts";
