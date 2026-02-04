/**
 * Auth module exports.
 */

export { createP256Auth, type P256AuthConfig, type P256AuthStrategy } from "./p256.ts";
// Permission checking
export {
  type ApiName,
  assertAccess,
  canAccess,
  checkPermission,
  getRequiredAuth,
  isPublicApi,
  type PermissionCheckResult,
} from "./permissions.ts";
export { createTicketAuth, type TicketAuthConfig, type TicketAuthStrategy } from "./ticket.ts";
export { createTokenAuth, type TokenAuthConfig, type TokenAuthStrategy } from "./token.ts";
// Auth strategy factories
export { createUserAuth, type UserAuthConfig, type UserAuthStrategy } from "./user.ts";
